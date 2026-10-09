# Contributing

## Dev setup

```sh
npm install
npm run dev      # API sur http://localhost:8000
```

## Scripts

| Commande           | Effet                                        |
| ------------------ | -------------------------------------------- |
| `npm run build`    | Compile TypeScript (`dist/`)                 |
| `npm run binaries` | Télécharge/extrait MuseScore (`resources/`) |
| `npm run desktop:dev` | Lance l'app Electron en dev               |
| `npm run dist:win` | Installateur Windows (NSIS)                  |
| `npm run dist:mac` | DMG macOS (à lancer sur Mac)                 |
| `npm run dist:linux` | AppImage Linux (à lancer sur Linux)        |

## Pull requests

- `npx tsc --noEmit` doit passer.
- Une PR = un sujet, description courte du changement et du test effectué.
- Pas de binaires, pas de `node_modules`, pas de fichiers perso (voir `.gitignore`).
