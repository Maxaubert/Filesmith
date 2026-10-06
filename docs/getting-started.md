# Getting started

How to install Filesmith, find your way around the main screen and run your first job.

- What each operation does and its options: [operations.md](operations.md)
- The `filesmith` command line: [cli.md](cli.md)
- Upscale and Generate models: [models.md](models.md)

## Install

1. Download the installer from GitHub Releases. This link always points at the newest version:
   <https://github.com/Maxaubert/Filesmith/releases/latest/download/Filesmith-Setup-x64.exe>
   (each release also carries a versioned copy, `Filesmith-Setup-x64-<version>.exe`).
2. Run it. The install is per-user, no admin rights needed. It goes to
   `%LOCALAPPDATA%\Programs\Filesmith` and adds a Start menu shortcut (no desktop shortcut).
3. The installer also puts the `filesmith` command on your per-user PATH. Terminals opened after the
   install see it; terminals that were already open do not.

**The build is unsigned.** Windows SmartScreen may show "Windows protected your PC". Click
**More info**, then **Run anyway**. Releases stay unsigned until the project is enrolled for code
signing.

Installing, updating or uninstalling closes every running `Filesmith.exe`, including a running CLI job.

## First run

Filesmith opens on **Convert** with an empty files table: "No files yet". Click **Add files**, press
**Ctrl+O**, or drag files anywhere onto the window.

Core tools (ffmpeg, ImageMagick, mutool, CaesiumCLT, 7-Zip and the rest) ship with the app, so convert,
compress, resize and the PDF tools work offline straight away. Background removal downloads its model on
first use. Writing RAR or CBR needs WinRAR installed; without it those targets stay greyed out.

## The main screen

```
+---------+-----------------------------------+-----------------------+
| Sidebar | Toolbar: Add files, count, View   | Inspector             |
|         |-----------------------------------| Options|Preview|Info  |
|         | Files table                       |                       |
|         |                                   |                       |
|         |-----------------------------------|                       |
|         | Console strip (Ctrl+`)            | Run / Stop            |
+---------+-----------------------------------+-----------------------+
```

### Sidebar

One entry per operation: **Convert**, **Compress**, **Resize**, **Upscale**, **Remove BG**,
**Generate** and **PDF Tools**, then **Completed** and **Settings**.

- Each operation keeps its own list of files. A number next to an entry shows files waiting there.
- **PDF Tools** opens a grid of cards: Extract text, Pages to PNG, Merge, Split, Burst, Extract images.
- **Ctrl+B** or the collapse button folds the sidebar to icons.
- Order and visibility are set in [Settings](#settings).

### Files table

- **Add files:** the **Add files** button, **Ctrl+O**, or drag and drop onto the window. Files the
  current operation cannot handle are skipped (Upscale does not take an MP4).
- Files are grouped by type (for example images, videos). A selection stays inside one group, because
  the options panel describes one set of targets. Clicking a file in another group moves the selection
  there.
- Click to select, **Ctrl+click** to add or remove, **Shift+click** for a range. Click a column header to
  sort.
- Each row has a small action that follows its state: Cancel while running, Show in folder when done,
  Retry after a failure or stop.
- Double-click or **Enter** opens the file in its default app.

### Right-click menu

Right-click a row (or press **Shift+F10** or the Menu key). On a selected row the menu acts on the whole
selection.

| Item                  | What it does                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Open in default app   | Opens the file (one file only)                                                                                           |
| Show in File Explorer | Shows the result when the row is done, else the source                                                                   |
| Retry                 | Runs failed or stopped files again with the options they last used                                                       |
| Stop                  | Cancels queued or running jobs                                                                                           |
| Clear finished        | Hides finished and stopped rows from the list                                                                            |
| Remove from list      | Takes rows off the list after a confirm. Files on disk are not touched; running jobs stop                                |
| Delete file           | Moves the **source** files to the Recycle Bin after a confirm. Results already made are kept. Off while a job is running |

### View sizes

Six sizes, named like File Explorer: **Details**, **Large details**, **Tiles**, **Medium icons**,
**Large icons**, **Extra large icons**.

- The **View** menu in the toolbar lists Details, Tiles and Extra large icons.
- **Ctrl+wheel** over the files steps through all six. Wheel up is bigger.
- **Ctrl+=** (or **Ctrl++**) bigger, **Ctrl+-** smaller, **Ctrl+0** back to Details.
- **Large details** is the Details table with taller rows, bigger thumbnails and larger names.
- The size is remembered between sessions.

### Inspector

The right panel has three tabs:

- **Options:** settings for the current operation, plus Output location (next to the source, or a
  folder you choose). Options apply to the selected files, or to all files in the group when nothing is
  selected.
- **Preview:** the selected file. Once a job is done, a wipe compares source and result: drag the divider,
  or use the Left and Right arrow keys.
- **Info:** details of the selected file, including the output path and any error.

Preview and Info show one file. With several selected, they ask you to pick one.

## Running and stopping jobs

1. Pick an operation in the sidebar and add files.
2. Set options in the inspector.
3. Click **Run** at the bottom of the inspector, or press **Ctrl+Enter**. The button names the work, for
   example "Convert 3 images".

Rows show live progress. While anything runs, **Run** turns into **Stop**, which cancels every queued and
running job in that operation. To stop only some files, use **Stop** in the right-click menu or the
row's Cancel action.

## Outputs never overwrite

Filesmith never overwrites your source or any existing file.

- Results go next to the source by default, or to the folder set under Options, Output location.
- If the plain name is free and differs from the source, it is used: `photo.png` converts to `photo.jpg`.
- Otherwise a tag is added: `photo (converted).jpg`, then `photo (converted 2).jpg`, and so on. Other
  operations use their own tag: `(compressed)`, `(resized)`, `(upscaled)`, `(no-bg)`.
- Output folders get `(2)`, `(3)`, and so on: `scans`, then `scans (2)`.

## Completed

**Completed** lists the results from every operation.

- Columns: name, which operation made it, kind, size and result.
- Double-click opens the result. The folder icon shows it in File Explorer.
- Right-click: Open in default app, Show in File Explorer, Delete file (to the Recycle Bin).
- **Delete selected** moves the selected results to the Recycle Bin.
- **Clear list** only hides the list; files stay on disk.

## Settings

- **Sidebar:** drag rows to reorder the sidebar (or focus a row and press **Alt+Up** / **Alt+Down**).
  Untick a row to hide it.
- **Tools:** status of WinRAR and background removal, the ComfyUI folder used by Generate (Choose or
  Change folder), and **Open folder** buttons for your own Upscale models and the model registry. See
  [models.md](models.md).
- **Claude:** installs or updates the Filesmith skill for Claude Code into
  `%USERPROFILE%\.claude\skills\filesmith`, so Claude can run Filesmith for you through the CLI.

## Keyboard shortcuts

| Keys                  | Action                                                                              |
| --------------------- | ----------------------------------------------------------------------------------- |
| Ctrl+O                | Add files                                                                           |
| Ctrl+Enter            | Run                                                                                 |
| Ctrl+B                | Collapse or expand the sidebar                                                      |
| Ctrl+`                | Open or close the console                                                           |
| Ctrl+wheel            | Step the view size                                                                  |
| Ctrl+= / Ctrl++       | Bigger view size                                                                    |
| Ctrl+-                | Smaller view size                                                                   |
| Ctrl+0                | Back to Details                                                                     |
| Arrow keys            | Move between files (all four arrows in the grid views)                              |
| Shift+arrow           | Extend the selection                                                                |
| Space                 | Select or deselect the focused file                                                 |
| Ctrl+A                | Select all files in the active group                                                |
| Enter                 | Open the focused file in its default app                                            |
| Delete                | Remove the selected files from the list (asks first; files on disk are not touched) |
| Shift+F10 or Menu key | Open the right-click menu                                                           |

View-size keys only work in the files view, and not while you type in a text field or the console.

## The console

The **Console** button in the bottom strip (or **Ctrl+`**) opens a console panel under the files table.
It runs **filesmith commands only**, without the `filesmith`prefix:`convert`, `compress`, `resize`,
`upscale`, `removebg`, `generate "<prompt>"`, `pdf <tool>`, and the helpers `formats`, `doctor`,
`setup`, `skill`. Anything else is refused with "Only filesmith commands run here". Use a terminal for
other programs. The full command reference is in [cli.md](cli.md).

Built-ins:

| Command       | What it does                                          |
| ------------- | ----------------------------------------------------- |
| `help`        | What the console runs                                 |
| `cd <folder>` | Change folder. `cd` alone prints it, `cd -` goes back |
| `history`     | Past commands                                         |
| `clear`       | Clear the output (also **Ctrl+L**)                    |

- Commands run in the console's folder, which starts at your Downloads folder and is remembered.
- Add `--help` to a command for its options. **Tab** completes commands and file names.
- **Up** and **Down** walk your history.
- **Ctrl+C** or the **Stop** button cancels a running command. With nothing running, Ctrl+C clears the
  prompt. If text is selected, Ctrl+C copies it instead.
- **Clear** empties the output. **Minimise** closes the panel; the strip then shows the running
  command's progress.
- Drag the top edge to resize the panel. **Esc** returns focus to the files table.
- Console jobs do not appear in the app's queue or Completed view, and the app's queue keeps working
  while one runs.
