# MIDI vers MusicXML

Convertit des fichiers MIDI en MusicXML via MuseScore, en local et hors-ligne.

- **App desktop** Windows / macOS / Linux (Electron, MuseScore embarqué)
- **Interface web** : drag & drop d'un ou plusieurs `.mid`, téléchargement direct des `.musicxml` (+ `.zip`)
- **API REST** : `POST /convert`, `POST /convert-batch`
- **Docker** : image tout-en-un (API + MuseScore)

## Téléchargement

Page [Releases](../../releases) : `.exe` (Windows), `.dmg` (macOS), `.AppImage` (Linux).

## Installation macOS (app non signée Apple)

L'application n'est pas notarisée par Apple : macOS la bloque au premier lancement.
Procédure :

1. Ouvre le `.dmg` et glisse l'app dans `Applications`.
2. **Clic droit** sur l'app → **Ouvrir** → confirmer **Ouvrir**.
   - Si le message persiste : Réglages Système → Confidentialité et sécurité →
     rubrique Sécurité → **Ouvrir quand même**.
3. Alternative en terminal :
   ```sh
   xattr -cr "/Applications/MIDI vers MusicXML.app"
   ```

*macOS (unsigned app): right-click the app → Open → confirm. If still blocked:
System Settings → Privacy & Security → "Open Anyway". Or run
`xattr -cr "/Applications/MIDI vers MusicXML.app"`.*

## Utilisation

1. Dépose tes `.mid` / `.midi` dans la zone de dépôt.
2. Chaque fichier est converti automatiquement.
3. Clique **Télécharger .musicxml** par fichier, ou **Tout télécharger (.zip)**.

## API (locale, port 8000)

| Endpoint         | Champ   | Réponse              |
| ---------------- | ------- | -------------------- |
| `GET /health`    | —       | `{ ok, binary }`     |
| `POST /convert`  | `file`  | 1 × `.musicxml`      |
| `POST /convert-batch` | `files` | 1 × `.zip`      |

```sh
curl -F "file=@piece.mid" http://localhost:8000/convert -o piece.musicxml
curl -F "files=@a.mid" -F "files=@b.mid" http://localhost:8000/convert-batch -o out.zip
```

## Docker

```sh
docker compose up --build -d
# UI : http://localhost:8000
```

## Dev

Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Code : [MIT](LICENSE).

MuseScore Studio embarqué reste sous sa licence **GPL-3.0** (© contributeurs MuseScore,
sources : <https://github.com/musescore/MuseScore>, binaires issus des releases officielles).
