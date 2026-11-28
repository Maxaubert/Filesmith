<div align="center">
  <img src="docs/logo.png" alt="Filesmith" width="116">

[![Latest release](https://img.shields.io/github/v/release/Maxaubert/Filesmith?style=flat-square&color=5b5bd6&cacheSeconds=1800)](https://github.com/Maxaubert/Filesmith/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Maxaubert/Filesmith/total?style=flat-square&color=5b5bd6&cacheSeconds=1800)](https://github.com/Maxaubert/Filesmith/releases)
[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=flat-square)](https://github.com/Maxaubert/Filesmith/releases/latest)
[![Built with](https://img.shields.io/badge/Electron%20·%20React%20·%20TypeScript-2b2e3a?style=flat-square)](docs/architecture.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-22b364?style=flat-square)](LICENSE)
</div>

Filesmith is a Windows desktop toolkit for everyday file jobs: convert, compress, resize, upscale,
remove backgrounds, generate images, and work with PDFs and archives. Drop in a batch of files, pick
the options and run it. Outputs go next to the sources by default and never overwrite anything (unless you tick Replace originals, which sends the original to the Recycle Bin). The same
engine is available as the `filesmith` command line, from a built-in console or any terminal.

![Filesmith converting a batch of images, with one job running](docs/screenshots/convert.png)

## Docs

- [Getting started](docs/getting-started.md): install, the main screen, your first job
- [Operations](docs/operations.md): what each operation does and its options
- [Models](docs/models.md): Upscale and Generate models, ComfyUI
- [Command line](docs/cli.md): the `filesmith` CLI and the in-app console
- [Architecture](docs/architecture.md): for developers, how the app is built, tested and shipped

## Verify your download

Releases after 0.9.1 include a `SHA256SUMS` file. In PowerShell, run `Get-FileHash .\Filesmith-Setup-x64.exe`
(use the name of the file you downloaded) and compare the hash with that file's line in `SHA256SUMS`
(letter case does not matter). With `sha256sum`, run `sha256sum -c SHA256SUMS --ignore-missing`.

## License

[MIT](LICENSE)

This covers Filesmith's own code. The installer also bundles third-party tools such as FFmpeg,
ImageMagick, Ghostscript and LibreOffice, each under its own licence. See
[THIRD-PARTY-NOTICES.md](resources/licenses/THIRD-PARTY-NOTICES.md).
