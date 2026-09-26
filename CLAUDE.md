## Principles

Don't include in the README:

- **Affichage progressif** : Une fois toutes les notifications lues, seules les premières restent affichées — les suivantes chargent en faisant défiler jusqu'en bas
- **Fermeture au clavier** : Échap ferme la modale de notification (ou toute autre modale ouverte sur `/pulls` et `/collection`)
- **Lancer l'enchère au clavier** : Appuyer sur Entrée dans le champ de mise de départ lance directement l'enchère
- **Focus automatique** : L'ouverture de la modale d'une carte place le curseur dans son champ de mise
- **Notification de carte rendue clarifiée** : « Votre carte "{nom}" vous est rendue. » devient « Personne n'a enchéri pour votre carte « {nom} ». »

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
