# Excel Charts Skill — Design Spec

**Date:** 2026-04-02
**Status:** Approved
**Location:** `~/.claude/skills/excel-charts/SKILL.md`

## Overview

A Claude Code skill that creates native Excel charts embedded in existing `.xlsx` workbooks using `openpyxl`. The skill produces polished, presentation-ready charts with professional default styling and user-overridable options.

**User-invocable:** Yes, as `/excel-charts`

## Triggers

- User mentions an `.xlsx` file and asks for a chart/graph/visualization
- User says "chart this data", "graph the spreadsheet", "add a chart to this Excel file"
- User references Excel and any chart type (bar, line, pie, scatter, etc.)

## Dependency

- `openpyxl` — the skill instructs Claude to check for it and install if missing (`pip install openpyxl`)

## Workflow

1. **Backup** — Copy the original file to `{stem}_backup_{YYYYMMDD_HHMMSS}{suffix}` in the same directory. Confirm the backup path to the user.

2. **Inspect the workbook** — Read the file with openpyxl. Report:
   - Sheet names and dimensions (rows x cols)
   - Column headers and data types (numeric, text, date)
   - Brief summary of available data

3. **Confirm chart request** — If the user hasn't fully specified, ask:
   - Which sheet/data range to chart
   - Chart type (bar, line, pie, scatter, area, radar, doughnut, etc.)
   - Where to place the chart (new sheet or embedded, with cell anchor)
   - Title, axis labels, any styling preferences

4. **Validate data fitness** — Check that the selected range is chart-ready:
   - Numeric data exists for values
   - Categories/labels are identifiable
   - If data isn't suitable, explain why and suggest what to restructure — don't fix it

5. **Create the chart** — Build using openpyxl with the default theme, applying any user overrides

6. **Save and confirm** — Save the modified workbook, report what was added and where

## Styling System

### Default Theme ("Executive")

- **Color palette:** 8 harmonious colors — navy (`#1F3864`), teal (`#2E8B8B`), coral (`#E07050`), gold (`#D4A843`), slate (`#5B6770`), sage (`#7A9A6D`), burgundy (`#8B3A4A`), steel blue (`#4682B4`)
- **Font:** Calibri 11pt for labels, 14pt bold for titles
- **Legend:** Bottom positioning to maximize chart area
- **Gridlines:** Light gray, major only
- **Chart size:** 15 x 10 (width x height in Excel units)
- **Style:** Flat/modern — no 3D effects
- **Plot area:** Subtle light gray fill

### User Overrides

When the user specifies preferences, they take precedence:
- **Colors** — "use company colors: #1B365D, #E87722" or "make it red and blue"
- **Font** — "use Arial" or "bigger title"
- **Legend position** — "legend on the right" or "no legend"
- **Size** — "make it smaller" or "full page width"
- **Chart style number** — "use Excel chart style 26" (built-in style IDs 1-48)

### Per Chart-Type Defaults

- **Bar/Column:** Slight gap between bars, data labels on if <=8 categories
- **Line:** Smooth lines with small markers, line width 2.5pt
- **Pie:** Data labels showing percentage + category, slight explosion on largest slice
- **Scatter:** Circle markers size 7, with trendline if user requests
- **Area:** Semi-transparent fills (70% opacity) so overlapping series remain visible

## Supported Chart Types

| Type | openpyxl Class | Config |
|------|---------------|--------|
| Bar (vertical) | `BarChart` | `type="col"` |
| Bar (horizontal) | `BarChart` | `type="bar"` |
| Stacked bar | `BarChart` | `grouping="stacked"` |
| Line | `LineChart` | With/without markers |
| Pie | `PieChart` | Single series only |
| Doughnut | `DoughnutChart` | Single series |
| Scatter | `ScatterChart` | X/Y pairs |
| Area | `AreaChart` | `grouping="standard"` or `"stacked"` |
| Radar | `RadarChart` | Comparison across categories |
| Combo | `BarChart` + `LineChart` | Bar + line via `y2_axis` |

### Code Pattern Coverage

Each chart type's reference pattern covers:
- Creating the chart object with correct class
- Setting up `Reference` objects for data and categories
- Adding series with labels
- Applying the default theme (colors, fonts, gridlines)
- Sizing and anchoring in the worksheet
- Common variations (stacked, grouped, percentage, etc.)

### Error Handling

- Empty data range — report to user, don't create chart
- Mixed types in value column — report which cells are non-numeric
- Single data point — warn that a chart may not be meaningful
- Too many categories for pie chart (>12) — suggest bar chart instead

## File Handling & Safety

### Backup

- Before any modification, copy to `{original_dir}/{stem}_backup_{YYYYMMDD_HHMMSS}{suffix}`
- Example: `sales.xlsx` -> `sales_backup_20260402_143022.xlsx`
- If backup path exists (same second), append `_2`, `_3`, etc.
- Report backup path before proceeding

### File Open/Save

- Open with `openpyxl.load_workbook(path, data_only=False)` — preserves formulas
- Never use `data_only=True` (destroys formulas, replaces with cached values)
- Save back to original path after adding charts
- On save failure (permission, locked), report error and suggest alternate path

### Sheet Naming

- Default: `{ChartType} Chart` (e.g., "Bar Chart", "Line Chart")
- If name exists, append number: "Bar Chart 2", "Bar Chart 3"
- User can specify custom sheet name

### Format Limitations

- `.xls` (old format) — openpyxl cannot read it. Detect and tell user to save as `.xlsx`
- Password-protected — cannot open. Report clearly.
- `.xlsm` (macros) — open with `keep_vba=True` to preserve macros

## Skill Structure

```
~/.claude/skills/excel-charts/
├── SKILL.md              # Frontmatter + workflow + styling defaults + chart patterns
└── references/
    └── chart-patterns.md # Detailed openpyxl code recipes for each chart type
```

The main `SKILL.md` contains the workflow, styling system, and decision logic. The `references/chart-patterns.md` contains the full code patterns that Claude copies and adapts — kept separate to avoid bloating the main skill file.
