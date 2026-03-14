# Claude Workbench — Visual Styles

Extends `~/.claude/UI-STANDARDS.md`.

## Colors

### Terminal Theme (Tokyo Night)
- Background: `#0f172a` (dark), `#ffffff` (light)
- Foreground: `#c0caf5` (dark), `#1e293b` (light)
- Cursor: matches foreground
- Session colors cycle through: blue `#7aa2f7`, green `#9ece6a`, red `#f7768e`, yellow `#e0af68`, purple `#bb9af7`, cyan `#7dcfff`, orange `#ff9e64`, white `#c0caf5`

### UI Chrome
- Surface backgrounds use Tailwind's slate scale (surface-50 through surface-950)
- Accent: blue-600 / blue-400 (dark)
- Borders: surface-200 (light), surface-700 (dark)

## Typography
- UI: Inter, system-ui
- Terminal: JetBrains Mono, Fira Code, Cascadia Code, Menlo
- Terminal font size: 14px, line height: 1.2

## Layout
- Header height: 48px
- Sidebar default width: 280px, collapsed: 48px
- Tiling gap: 4px (2px margins on mosaic tiles)
- Floating window min size: 400x250

## Components
- Terminal header: 32px height, session color left-border (3px)
- Toast notifications: lower-right corner, 300px max width, z-50
- Command palette: centered, 15vh from top, 512px max width
- Search modal: centered, 10vh from top, 672px max width
