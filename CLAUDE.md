## Principles

### Docs

NEVER bump the version in the docblock at the top of the JS file.

Every new rule/feature must be appended the documentation file `DOCS.md`, once its development is complete.
DO NOT move an existing rule/feature upon modification.
The same principle applies to the main() function and TUTORIAL_ENTRIES.

The documentation file is the primary source of truth for feature description to put in the README.
Implementation (JS file) also has a docblock near each rule/feature: look there if you want details.
When updating the README, check ALL rules/features (both from the documentation file and the JS file) — some might have been enhanced since the last version

### Metadata for development

| Name                | URL                 | Description                                                      |
| ------------------- | ------------------- | ---------------------------------------------------------------- |
| Marketplace         | /marketplace        | Marketplace home page                                            |
| Bids                | /marketplace/{UUID} | Card bidding page                                                |
| Profile             | /profile/{username} | User profile page                                                |
| Own profile         | /profile            | User's own profile page                                          |
| Pulls               | /pulls              | Card packs to open page                                          |
| Personal collection | /collection         | User's personal card collection page                             |
| Wishlist            | /global-collection  | Global collection from where users can view their wishlist cards |

| Description             | DOM Identifier                           | In DOM via user action? |
| ----------------------- | ---------------------------------------- | ----------------------- |
| Notifications container | div.card-frame.shadow-xl.overflow-hidden | Yes                     |
| Bid card's name         | h1.flex-1                                | No                      |
| Owned card label        | span.bg-emerald-600/90                   | No                      |
| Bid card price          | span.text-2xl                            | No                      |
| Owned card modal        | div.card-frame.p-6                       | Yes                     |

### READMEignore

- **Affichage progressif** : Une fois toutes les notifications lues, seules les premières restent affichées — les suivantes chargent en faisant défiler jusqu'en bas
- **Fermeture au clavier** : Échap ferme la modale de notification (ou toute autre modale ouverte sur `/pulls` et `/collection`)
- **Lancer l'enchère au clavier** : Appuyer sur Entrée dans le champ de mise de départ lance directement l'enchère
- **Focus automatique** : L'ouverture de la modale d'une carte place le curseur dans son champ de mise
- **Notification de carte rendue clarifiée** : « Votre carte "{nom}" vous est rendue. » devient « Personne n'a enchéri pour votre carte « {nom} ». »
- **Enchère perdue clarifiée** : « {enchérisseur} a misé {mise} wikibidous sur « {carte} ». Vos {remise} wikibidous vous ont été remboursés. » devient « Enchère pour « {carte} » : {mise} > {remise}. Réenchérissez pour gagner la carte. », avec la mise adverse mise en évidence en jaune
- **Vente et achat de cartes mis en évidence** : les notifications de carte vendue ou remportée affichent le montant en couleur — vert pour une vente, rouge pour un achat
- **Favicon personnalisé** : L'onglet du navigateur affiche le logo Wiki-MasterBetter à la place du favicon du site
- **Bouton retour plus clair** : Relabellisé « Retour en arrière » sur les pages d'enchère
- **Modale de carte épurée** : Sur `/collection` et `/pulls`, les mentions légales n'apparaissent plus dans la modale d'une carte, laissant plus de place à l'essentiel
- **Bouton « tout marquer comme lu » à gauche** : Repositionné du côté gauche du panneau de notifications
- **Boutons de profil plus lisibles** : Meilleur contraste pour les boutons d'action affichés sur les pages de profil
- **Liste d'étiquettes qui suit le clavier** : Dans la modale de carte, la liste défile automatiquement pour garder l'étiquette sélectionnée au clavier visible
- **Bannière d'achat estompée** : Une fois qu'il ne vous reste plus aucun paquet à ouvrir, la bannière qui vous encourage à en acheter s'estompe
- **Rechargement automatique** : Une fois la pile de paquets pleine, la page se recharge d'elle-même toutes les 10 minutes tant qu'elle le reste
- **Notifications de liste de souhaits clarifiées** : Le nom de la carte mise en vente est encadré de guillemets, et « mise en vente » est teinté en rose pour mieux se repérer
