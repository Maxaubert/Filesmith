# Third-party notices

Filesmith's own code is under the MIT License (see `LICENSE` in the source repository,
https://github.com/Maxaubert/Filesmith).

The Windows installer also bundles the third-party programs listed below. Each one keeps its
own licence. Filesmith runs these programs unmodified, as separate processes, and passes them
command-line arguments. It does not link to them.

The installed app keeps this file in `resources\licenses\`. The full licence texts are in
`resources\licenses\texts\`, unless a section names another file.

The versions below are the ones the release build downloads and checks by SHA-256
(`scripts/pinned-tools.mjs` in the source repository).

## Bundled programs

### FFmpeg (ffmpeg.exe, ffprobe.exe)

- Version: 9.0.2, "essentials" build by Gyan Doshi (gyan.dev)
- Licence: GPL-3.0-or-later. The build is configured with `--enable-gpl --enable-version3`
  (shown by `ffmpeg -version`), so the binaries as a whole are under the GNU GPL version 3.
  The external libraries compiled into the build keep their own licences.
- Licence text: `texts/GPL-3.0.txt`
- Project: https://ffmpeg.org/ (licence notes: https://ffmpeg.org/legal.html)
- Build page: https://www.gyan.dev/ffmpeg/builds/
- Binary we bundle: https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.7z
- Source: see "Source code offer" below.
- Installed at: `resources\bin\ffmpeg.exe`, `resources\bin\ffprobe.exe`

### MuPDF (mutool.exe)

- Version: 1.23.0
- Licence: AGPL-3.0-or-later (from the MuPDF 1.23.0 `README` and `COPYING`)
- Licence text: `texts/AGPL-3.0.txt`
- Project: https://mupdf.com/
- Binary we bundle: https://mupdf.com/downloads/archive/mupdf-1.23.0-windows.zip
- Source: see "Source code offer" below.
- Installed at: `resources\bin\mutool.exe`

### Ghostscript (gswin64c.exe and its lib, Resource and iccprofiles folders)

- Version: 10.07.1
- Licence: AGPL-3.0-or-later (from the ghostpdl 10.07.1 `LICENSE`). The CMap files in
  `Resource/CMap` are copyright Adobe Systems Incorporated under a separate licence, and the
  font files in `Resource/Font` are under the AGPL with a font exception. Both are described in
  the upstream `LICENSE` file.
- Licence text: `texts/AGPL-3.0.txt`
- Project: https://www.ghostscript.com/
- Binary we bundle: https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10071/gs10071w64.exe
  (Filesmith ships the `bin`, `lib`, `Resource` and `iccprofiles` folders of this installer.)
- Source: see "Source code offer" below.
- Installed at: `resources\ghostscript\`

### 7-Zip (7z.exe, 7z.dll)

- Version: 26.02
- Licence: LGPL-2.1-or-later for most of the code, LGPL-2.1-or-later with the unRAR licence
  restriction for some code, and BSD-3-Clause and BSD-2-Clause for some code in 7z.dll
- Licence text: the 7-Zip licence file that ships beside the program,
  `resources\bin\7-Zip-License.txt` (it holds the unRAR restriction and the BSD texts), and
  `texts/LGPL-2.1.txt`
- Project: https://www.7-zip.org/ and https://github.com/ip7z/7zip
- Binary we bundle: https://github.com/ip7z/7zip/releases/download/26.02/7z2602-x64.exe
  (the build also uses https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe to
  unpack it; 7zr.exe is not shipped)
- Source: https://github.com/ip7z/7zip/releases/download/26.02/7z2602-src.tar.xz
- Installed at: `resources\bin\7z.exe`, `resources\bin\7z.dll`

### ImageMagick (magick.exe, its DLLs, configuration files and coder modules)

- Version: 7.1.2-29 Q16-HDRI x64 (dynamic "dll" build)
- Licence: ImageMagick License (SPDX: ImageMagick)
- Licence text: `texts/ImageMagick.txt`
- Project: https://imagemagick.org/ (licence: https://imagemagick.org/license/)
- Binary we bundle: https://github.com/ImageMagick/ImageMagick/releases/download/7.1.2-29/ImageMagick-7.1.2-29-Q16-HDRI-x64-dll.exe
- Source: https://github.com/ImageMagick/ImageMagick/archive/refs/tags/7.1.2-29.tar.gz
- Note: the ImageMagick Windows build includes third-party delegate libraries (the
  `CORE_RL_*.dll` files) under their own licences. See the ImageMagick Windows build
  repository for the list: https://github.com/ImageMagick/ImageMagick-Windows
- Installed at: `resources\bin\` (magick.exe, `CORE_RL_*.dll`, `*.xml`, `*.icc`, `modules\`)

### CaesiumCLT (caesiumclt.exe)

- Version: 1.4.0
- Licence: Apache-2.0 (from `LICENSE.md` at tag v1.4.0)
- Licence text: `texts/Apache-2.0.txt`
- Project: https://github.com/Lymphatus/caesium-clt
- Binary we bundle: https://github.com/Lymphatus/caesium-clt/releases/download/v1.4.0/caesiumclt-v1.4.0-x86_64-pc-windows-msvc.zip
- Source: https://github.com/Lymphatus/caesium-clt/archive/refs/tags/v1.4.0.tar.gz
- Installed at: `resources\bin\caesiumclt.exe`

### LibreOffice

- Version: 26.2.4.2
- Licence: MPL-2.0, with many third-party components under their own licences
- Licence text: `texts/MPL-2.0.txt`. The full notices for LibreOffice and every component it
  contains ship inside the LibreOffice folder: `resources\libreoffice\LICENSE.html`,
  `resources\libreoffice\license.txt` and `resources\libreoffice\NOTICE`.
- Project: https://www.libreoffice.org/ (licences: https://www.libreoffice.org/about-us/licenses/)
- Binary we bundle: https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.4.2/win/x86_64/LibreOffice_26.2.4.2_Win_x86-64.msi
- Source: https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.4.2/src/
- Installed at: `resources\libreoffice\`

### Real-ESRGAN ncnn Vulkan (realesrgan-ncnn-vulkan.exe and two models)

- Version: Real-ESRGAN v0.2.5.0, realesrgan-ncnn-vulkan build 20220424
- Licences:
  - Real-ESRGAN (the models `realesrgan-x4plus` and `realesrgan-x4plus-anime`): BSD-3-Clause,
    text in `texts/BSD-3-Clause-Real-ESRGAN.txt`
  - Real-ESRGAN-ncnn-vulkan (the program): MIT, text in `texts/MIT-Real-ESRGAN-ncnn-vulkan.txt`
  - ncnn (Tencent, built into the program): BSD-3-Clause, text in `texts/BSD-3-Clause-ncnn.txt`
  - Other libraries built into the program keep their own licences; see the upstream
    repositories below.
- Projects: https://github.com/xinntao/Real-ESRGAN, https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan,
  https://github.com/Tencent/ncnn
- Binary we bundle: https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip
  (Filesmith ships the exe, `vcomp140.dll` and the two models above.)
- Source: https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0 and
  https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan
- Installed at: `resources\realesrgan\`

### Microsoft Visual C++ and OpenMP runtime DLLs

- Files: `msvcp140*.dll`, `vcruntime140*.dll`, `mfc140u.dll`, `vcomp140.dll` in
  `resources\bin\` and `vcomp140.dll` in `resources\realesrgan\`
- They come inside the ImageMagick and Real-ESRGAN packages above and are Microsoft
  redistributable files under the Microsoft Visual C++ redistributable terms.

## Parts of the app itself

### Electron

- Version: 43.1.1
- Licence: MIT, text in `texts/MIT-Electron.txt`. The install folder also holds
  `LICENSE.electron.txt` and `LICENSES.chromium.html`, the notices for Chromium and the other
  components inside Electron.
- Project: https://www.electronjs.org/

### React, React DOM and scheduler

- Version: 19.2.7 (scheduler 0.27.0)
- Licence: MIT, text in `texts/MIT-React.txt`
- Project: https://react.dev/

### Tailwind CSS

- Version: 4.3.2 (generated CSS only)
- Licence: MIT, text in `texts/MIT-Tailwind-CSS.txt`
- Project: https://tailwindcss.com/

### IBM Plex Sans and IBM Plex Mono fonts (via Fontsource)

- Version: @fontsource/ibm-plex-sans 5.3.0, @fontsource/ibm-plex-mono 5.3.0
- Licence: OFL-1.1, texts in `texts/OFL-1.1-IBM-Plex-Sans.txt` and
  `texts/OFL-1.1-IBM-Plex-Mono.txt`
- Project: https://github.com/IBM/plex and https://fontsource.org/

## Source code offer

FFmpeg, MuPDF and Ghostscript are under the GNU GPL or the GNU AGPL. Filesmith ships them
unmodified, as separate programs that it starts with command-line arguments. The source code
for the exact versions it ships is available here:

- FFmpeg 9.0.2: https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz . The external libraries in
  the gyan.dev "essentials" build, with their versions, are listed on
  https://www.gyan.dev/ffmpeg/builds/ and in the release
  https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2 .
- MuPDF 1.23.0: https://mupdf.com/downloads/archive/mupdf-1.23.0-source.tar.gz
- Ghostscript 10.07.1: https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10071/ghostscript-10.07.1.tar.gz
  (the full ghostpdl tree is at
  https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10071/ghostpdl-10.07.1.tar.gz)

If a link above stops working, or you want the source of any bundled component for the
version in your installer, open an issue at https://github.com/Maxaubert/Filesmith/issues and
we will provide it.

## Downloaded on request, not bundled

These are not in the installer. Filesmith downloads them only when you ask for a feature that
needs them, from their own publishers. Their own licences apply.

- uv (Python installer used to set up the Python tools): https://github.com/astral-sh/uv
- rembg (background removal) and its models: https://github.com/danielgatis/rembg
- PyTorch: https://pytorch.org/
- spandrel (loads upscale models): https://github.com/chaiNNer-org/spandrel
- NVIDIA PiD code and model weights: https://github.com/nv-tlabs/PiD and
  https://huggingface.co/nvidia/PiD . The NVIDIA licences that come with the code and the
  weights apply.
- ComfyUI models (Generate and Upscale): each model's own page and licence, shown in the app
  where you choose the model. ComfyUI itself: https://github.com/comfyanonymous/ComfyUI
- WinRAR (Rar.exe) is never bundled or downloaded. Filesmith only uses an existing install.
