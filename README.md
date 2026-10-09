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

## Soundslice (optionnel)

Envoi direct d'un fichier vers ton compte Soundslice (`POST /publish-soundslice`,
champ `file` `.mid/.midi/.musicxml`, `name`/`artist` optionnels → `{ scorehash, url }`).
L'interface affiche un bouton **Soundslice** par fichier quand c'est configuré
(voir `GET /health` → champ `soundslice`).

Prérequis (côté Soundslice) :

1. Compte payant **Teacher** ou **Licensing** (seuls ces plans ont une clé API : app ID + mot de passe).
2. Permission spéciale **"Upload a slice's notation"** à demander à Soundslice
   ([contact](https://www.soundslice.com/contact/)), sinon l'upload répond `403`.

Configuration (interface web → Réglages, ou variables d'environnement —
jamais commité, `.env` ignoré par git) :

```sh
SOUNDSLICE_APP_ID="ton_app_id"
SOUNDSLICE_PASSWORD="ton_mot_de_passe"
```

La clé peut aussi être saisie dans l'interface (section Réglages, bouton Tester
la connexion). Elle est stockée uniquement sur l'appareil (`DATA_DIR`,
fichier `store.json` en lecture restreinte) et n'est jamais renvoyée en clair
par l'API (`GET /settings` ne retourne qu'un identifiant masqué).

```sh
curl -F "file=@piece.mid" -F "name=Mon morceau" http://localhost:8000/publish-soundslice
```

## Workflows

Un workflow = une configuration nommée et rejouable (conversion + publication
optionnelle, artiste, liste, embed). Gérable depuis l'interface (section
Workflows + Historique) ou l'API :

```sh
curl -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Niveaux","listId":"123","embedStatus":4}' \
  http://localhost:8000/workflows
curl -F "files=@a.musicxml" -F "files=@b.mid" http://localhost:8000/workflows/<id>/run
curl http://localhost:8000/workflows   # lister
curl http://localhost:8000/runs        # historique des runs
```

Envoi en lot (équivalent du script `soundslice_upload.py`) :
titre lu dans `<work-title>` du MusicXML (sinon nom du fichier),
`listId` pour ranger dans une liste, `embedStatus` (`1`, `2` ou `4`),
`dryRun=true` pour lister sans rien envoyer → récap JSON
(`soundslice_resultats.json` téléchargeable depuis l'interface).

```sh
curl -F "files=@a.musicxml" -F "files=@b.mid" -F dryRun=true http://localhost:8000/publish-soundslice-batch
curl -F "files=@a.musicxml" -F "files=@b.mid" -F listId=123 -F embedStatus=4 http://localhost:8000/publish-soundslice-batch
```

Docs API : <https://www.soundslice.com/help/data-api/>

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
