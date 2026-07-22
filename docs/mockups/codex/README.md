# Filesmith operation placement concepts

These mockups explore where operations can live after the left rail changes from tools to file types. Each screen uses PDF as the active type because its seven operations are the strongest layout test. The queue also includes recent image work so the relationship between file type navigation and a persistent multi-file queue stays visible.

## Concept 1: Operation Inspector

File types stay in the left rail and operations move into the top half of the right inspector. Selecting an operation reveals its settings directly below, while the primary action remains pinned at the bottom.

PDF's seven operations use a compact two-column matrix. All seven remain visible at once, with Compress spanning a normal grid cell and the selected state linking it clearly to the settings section.

Trade-offs:

- This follows the user's instinct and preserves the current three-column mental model.
- Operation choice and configuration feel like one continuous task.
- The right panel becomes dense for PDF, leaving less room for detailed settings.
- Long operation names or future PDF actions could require scrolling.

## Concept 2: Command Shelf

Operations live in a horizontal command shelf directly under the file type heading. The right sidebar is reserved for settings, estimates, and the primary action.

PDF's seven operations are divided into meaningful visual groups: extraction, document structure, and optimization. The shelf uses the full workspace width, so every action is visible without an overflow menu while the active operation remains easy to scan.

Trade-offs:

- Operations are highly discoverable and can be compared quickly.
- Settings get the full right sidebar and can grow without displacing the operation chooser.
- The shelf uses vertical space above the working queue.
- If a file type gains many more operations, grouping or a second row would be needed.

## Concept 3: Workflow Canvas

Operations live in a central recipe builder. The selected operation, its settings, the input files, and the output preview read as one batch workflow. The permanent right sidebar is removed, and the primary action moves to a full-width footer.

PDF's seven operations appear as a stable card catalog in the recipe builder. All seven fit in a four-column grid, and the adjacent configuration panel gives the active operation room for settings without shrinking the catalog.

Trade-offs:

- The workflow is explicit and supports batch processing well.
- It offers the most room for future settings and multi-step recipes.
- It is the largest departure from the current Filesmith layout.
- Users who frequently switch operations may find the recipe framing heavier than a simple tool switch.

## Recommendation

Concept 2, Command Shelf, is recommended because it keeps all seven PDF operations immediately visible, protects the right sidebar for focused settings, and introduces the smallest structural change to the existing app.

## Files

- `codex-1.html`: Operation Inspector
- `codex-2.html`: Command Shelf
- `codex-3.html`: Workflow Canvas
