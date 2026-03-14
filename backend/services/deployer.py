"""Deploy pipeline execution service."""

import asyncio
import json
import logging
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Callable, Awaitable

from services.deploy_config import DeployConfig, load_deploy_config

logger = logging.getLogger(__name__)


class DeployError(Exception):
    pass


class Deployer:
    """Executes deploy pipelines for projects."""

    def __init__(self):
        # Track active deploys: project_path -> asyncio.Task
        self.active_deploys: dict[str, asyncio.Task] = {}

    def is_deploying(self, project_path: str) -> bool:
        task = self.active_deploys.get(project_path)
        return task is not None and not task.done()

    async def deploy(
        self,
        project_path: str,
        config: DeployConfig,
        on_output: Optional[Callable[[str], Awaitable[None]]] = None,
        skip_build: bool = False,
        dry_run: bool = False,
    ) -> dict:
        """
        Execute deploy pipeline. Returns result dict.
        on_output: async callback for streaming log lines.
        """
        log_lines: list[str] = []
        start_time = datetime.now(timezone.utc)

        async def emit(line: str):
            log_lines.append(line)
            if on_output:
                await on_output(line)

        try:
            await emit(f"=== Deploy started: {config.project.name} ===")
            await emit(f"Time: {start_time.isoformat()}")
            await emit(f"Project: {project_path}")

            if dry_run:
                await emit("\n[DRY RUN] — showing what would execute, no changes made.\n")

            # If deploy_script is set, delegate to it
            if config.deploy_script:
                await emit(f"\nDelegating to deploy script: {config.deploy_script}")
                if not dry_run:
                    await self._run_script(config.deploy_script, project_path, emit)
                else:
                    await emit(f"  Would run: {config.deploy_script}")
            else:
                # Standard pipeline
                # 1. Pre-checks
                await self._pre_checks(project_path, config, emit, dry_run)

                # 2. Build
                if not skip_build and config.build:
                    await self._build(project_path, config, emit, dry_run)
                elif skip_build:
                    await emit("\n[SKIP] Build step skipped")

                # 3. Sync
                if config.sync and config.prod:
                    await self._sync(project_path, config, emit, dry_run)

                # 4. Post-deploy
                if config.post_deploy and config.prod:
                    await self._post_deploy(config, emit, dry_run)

                # 5. Health check
                if config.prod and config.prod.health_url:
                    await self._health_check(config, emit, dry_run)

            end_time = datetime.now(timezone.utc)
            duration = (end_time - start_time).total_seconds()
            status = "success"
            await emit(f"\n=== Deploy completed in {duration:.1f}s ===")

        except DeployError as e:
            status = "failed"
            await emit(f"\n=== Deploy FAILED: {e} ===")
        except asyncio.CancelledError:
            status = "cancelled"
            await emit("\n=== Deploy CANCELLED ===")
            raise
        except Exception as e:
            status = "failed"
            await emit(f"\n=== Deploy ERROR: {e} ===")
            logger.exception("Deploy error for %s", project_path)

        # Write last-deploy.json
        result = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": status,
            "commit": self._get_git_commit(project_path),
            "duration_seconds": (datetime.now(timezone.utc) - start_time).total_seconds(),
            "dry_run": dry_run,
        }
        self._write_deploy_result(project_path, result)
        self._write_deploy_log(project_path, log_lines)

        return result

    async def _run_script(self, script_path: str, cwd: str, emit: Callable):
        """Run a deploy script, streaming output."""
        if not os.path.isfile(script_path):
            raise DeployError(f"Deploy script not found: {script_path}")

        proc = await asyncio.create_subprocess_exec(
            "bash", script_path,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            await emit(line.decode().rstrip())
        await proc.wait()
        if proc.returncode != 0:
            raise DeployError(f"Deploy script exited with code {proc.returncode}")

    async def _pre_checks(self, project_path: str, config: DeployConfig, emit: Callable, dry_run: bool):
        """Run pre-deployment checks."""
        await emit("\n--- Pre-checks ---")

        # Git status
        try:
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=project_path, capture_output=True, text=True, timeout=10
            )
            dirty = bool(result.stdout.strip())
            await emit(f"  Git status: {'dirty (uncommitted changes)' if dirty else 'clean'}")
        except Exception as e:
            await emit(f"  Git status: unable to check ({e})")

        # SSH connectivity (if prod is configured)
        if config.prod and config.prod.host:
            if dry_run:
                await emit(f"  SSH check: would test connection to {config.prod.ssh_user}@{config.prod.host}")
            else:
                await emit(f"  SSH check: testing connection to {config.prod.host}...")
                try:
                    ssh_args = ["ssh", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes"]
                    if config.prod.ssh_key:
                        ssh_args += ["-i", config.prod.ssh_key]
                    ssh_args += [f"{config.prod.ssh_user}@{config.prod.host}", "echo ok"]
                    result = subprocess.run(ssh_args, capture_output=True, text=True, timeout=10)
                    if result.returncode == 0:
                        await emit("  SSH check: OK")
                    else:
                        await emit(f"  SSH check: FAILED — {result.stderr.strip()}")
                        raise DeployError("SSH connectivity check failed")
                except subprocess.TimeoutExpired:
                    raise DeployError("SSH connection timed out")

    async def _build(self, project_path: str, config: DeployConfig, emit: Callable, dry_run: bool):
        """Run frontend build."""
        await emit("\n--- Build ---")
        if not config.build or not config.build.frontend:
            await emit("  No build configuration, skipping")
            return

        build = config.build.frontend
        build_dir = os.path.join(project_path, build.dir)
        await emit(f"  Directory: {build_dir}")
        await emit(f"  Command: {build.command}")

        if dry_run:
            await emit("  [DRY RUN] Would execute build command")
            return

        proc = await asyncio.create_subprocess_shell(
            build.command,
            cwd=build_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            await emit(f"  {line.decode().rstrip()}")
        await proc.wait()
        if proc.returncode != 0:
            raise DeployError(f"Build failed with exit code {proc.returncode}")
        await emit("  Build complete")

    async def _sync(self, project_path: str, config: DeployConfig, emit: Callable, dry_run: bool):
        """Rsync files to remote."""
        await emit("\n--- Sync ---")
        if not config.prod:
            return

        for rule in config.sync:
            source = os.path.join(project_path, rule.source)
            dest = f"{config.prod.ssh_user}@{config.prod.host}:{config.prod.remote_path}/{rule.dest}"

            cmd = ["rsync", "-avz", "--progress"]
            if rule.delete:
                cmd.append("--delete")
            for exc in rule.exclude:
                cmd += ["--exclude", exc]
            if config.prod.ssh_key:
                cmd += ["-e", f"ssh -i {config.prod.ssh_key}"]
            cmd += [source, dest]

            await emit(f"  Syncing {rule.source} → {rule.dest}")
            if dry_run:
                await emit(f"  [DRY RUN] Would run: {' '.join(cmd)}")
                continue

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                await emit(f"    {line.decode().rstrip()}")
            await proc.wait()
            if proc.returncode != 0:
                raise DeployError(f"Rsync failed for {rule.source}")

    async def _post_deploy(self, config: DeployConfig, emit: Callable, dry_run: bool):
        """Run post-deploy commands on remote."""
        await emit("\n--- Post-deploy ---")
        if not config.prod:
            return

        for step in config.post_deploy:
            # Interpolate {remote_path}
            command = step.command.replace("{remote_path}", config.prod.remote_path or "")
            desc = step.description or command[:60]
            await emit(f"  [{desc}]")
            await emit(f"  Command: {command}")

            if dry_run:
                await emit("  [DRY RUN] Would execute on remote")
                continue

            ssh_cmd = ["ssh"]
            if config.prod.ssh_key:
                ssh_cmd += ["-i", config.prod.ssh_key]
            ssh_cmd += [f"{config.prod.ssh_user}@{config.prod.host}", command]

            proc = await asyncio.create_subprocess_exec(
                *ssh_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                await emit(f"    {line.decode().rstrip()}")
            await proc.wait()
            if proc.returncode != 0:
                await emit(f"  WARNING: command exited with code {proc.returncode}")

    async def _health_check(self, config: DeployConfig, emit: Callable, dry_run: bool):
        """Check production health after deploy."""
        await emit("\n--- Health check ---")
        url = config.prod.health_url
        await emit(f"  URL: {url}")

        if dry_run:
            await emit("  [DRY RUN] Would check health endpoint")
            return

        import httpx
        # Retry a few times since services may be restarting
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=10, verify=False) as client:
                    resp = await client.get(url)
                    if resp.is_success:
                        await emit(f"  Health check: OK ({resp.status_code})")
                        return
                    else:
                        await emit(f"  Attempt {attempt + 1}: got {resp.status_code}")
            except Exception as e:
                await emit(f"  Attempt {attempt + 1}: {e}")
            if attempt < 2:
                await asyncio.sleep(3)

        await emit("  WARNING: Health check failed after 3 attempts")

    def _get_git_commit(self, project_path: str) -> Optional[str]:
        """Get current git commit hash."""
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=project_path, capture_output=True, text=True, timeout=5
            )
            return result.stdout.strip() if result.returncode == 0 else None
        except Exception:
            return None

    def _write_deploy_result(self, project_path: str, result: dict):
        """Write last-deploy.json to project root."""
        try:
            path = Path(project_path) / "last-deploy.json"
            with open(path, "w") as f:
                json.dump(result, f, indent=2)
        except Exception as e:
            logger.error("Failed to write last-deploy.json: %s", e)

    def _write_deploy_log(self, project_path: str, lines: list[str]):
        """Write deploy log to project root."""
        try:
            path = Path(project_path) / "deploy.log"
            with open(path, "w") as f:
                f.write("\n".join(lines))
        except Exception as e:
            logger.error("Failed to write deploy.log: %s", e)


# Global deployer instance
deployer = Deployer()
