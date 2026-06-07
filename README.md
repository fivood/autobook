# ebook-reader-desktop

Desktop build of [ttu-ebook-reader](https://github.com/ttu-ttu/ebook-reader), packaged with [Tauri](https://tauri.app/) for personal use on Windows and macOS.

Forked from the upstream `apps/web` package and adapted to ship as a native installer instead of a PWA.

## Develop

```sh
npm install
npm run tauri:dev
```

## Build installer

```sh
npm run tauri:build
```

Produces `.msi` / `.exe` (Windows) or `.dmg` (macOS) under `src-tauri/target/release/bundle/`.

## License

Inherits the upstream project's license — see `LICENSE`.
