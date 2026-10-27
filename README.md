<div align="center" id="top">
  <img src="./wikimasterbetter-logo.svg" alt="Wiki-MasterBetter" width="120" height="120" />
  <h2>Wiki-MasterBetter</h2>
  <p>Une collection de fonctionnalités et d'ajustements pour améliorer l'expérience utilisateur sur WikiMasters</p>
</div>

<div align="center">
  <a href="#-description">Description</a> &#xa0; | &#xa0;
  <a href="#-installation">Installation</a> &#xa0; | &#xa0;
  <a href="#-utilisation">Utilisation</a> &#xa0; | &#xa0;
  <a href="#-fonctionnalités">Fonctionnalités</a>
</div>&#xa0;

<div align="center">
  <a href="https://github.com/QuentindiMeo/Wiki-MasterBetter/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/QuentindiMeo/Wiki-MasterBetter?style=flat&color=%23ffe937&logo=github" /></a>
  <a href="https://github.com/QuentindiMeo/Wiki-MasterBetter/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/QuentindiMeo/Wiki-MasterBetter?color=forestgreen&logo=target" /></a>
</div>

&#xa0;

<div align="center">
  <b>Si ce script vous est utile, laissez une ⭐ sur le repo — ça aide à le faire connaître !</b>
  <br />
  <a href="https://ko-fi.com/quentindimeo">
    <img alt="ko-fi tip button" src="https://storage.ko-fi.com/cdn/brandasset/v2/support_me_on_kofi_blue.png" height="32px" />
  </a>
</div>&#xa0;

## 📝 Description

Un script local Tampermonkey qui ajoute une couche d'ajustements de confort, de raccourcis et de petites automatisations sur [wiki-masters.com](https://www.wiki-masters.com) — navbar compacte ou dépliée, notifications plus intelligentes, pulls pilotables au clavier, suivi des prix du marché, et bien plus.

## 🚀 Installation

1. Installez [Tampermonkey](https://www.tampermonkey.net/) (ou un gestionnaire de scripts local compatible) dans votre navigateur
2. Ouvrez le tableau de bord de Tampermonkey et créez un nouveau script
3. Collez le contenu de [`wiki-masterbetter.me.js`](./wiki-masterbetter.me.js) et enregistrez
4. Rendez-vous sur [wiki-masters.com](https://www.wiki-masters.com) — le script s'active automatiquement (rafraîchissez la page si elle était déjà ouverte)

## 📖 Utilisation

1. Naviguez sur [wiki-masters.com](https://www.wiki-masters.com) comme d'habitude — chaque ajustement s'applique automatiquement
2. La permission de notifications peut être demandée pour les fonctionnalités de notification push (paquets qui s'accumulent, enchère bientôt expirée)
3. Certaines données (préférence de navbar repliée, regroupement des enchères, suivi des prix de vente) persistent d'une visite à l'autre via le stockage de Tampermonkey et `localStorage`
4. Ouvrez votre profil une fois pour activer toutes les fonctionnalités liées à vos ventes et à vos enchères

## 🎯 Fonctionnalités

Je ne liste que celles qui change quelque chose de significatif pour l'utilisateur.

### 🔔 Barre de navigation & Notifications

- **Barre de navigation repliable** : Compacte par défaut (seulement des icônes) et statique, elle ne réagit pas au survol : le bouton 📌 en bas de la barre la déplie ou la recompacte, et votre choix est retenu ; compacte, au survol, chaque lien affiche son nom dans une infobulle stylisée à droite de la barre
- **Indicateur de fonctionnement** : Une mention « ✓ WMB v{version} » sous le logo du site confirme que le script tourne, et indique sa version
- **Panneau de configuration** : Un bouton à roue crantée, à côté de celui d'épinglage, ouvre une modale à deux onglets ; les choix sont sauvegardés dans votre cache de navigateur dès que vous les faites, sans recharger la page
  - **« Configuration »** : des réglages rangés par thème, chacun expliqué dans une infobulle
    - **Enchères & marché** : durée d'enchère par défaut, délai de suppression automatique des enchères surveillées, onglet du marché ouvert à l'arrivée, opacité des cartes estompées par « ▲ Estomper »
    - **Prix de vente observés** : nombre de prix gardés par carte et nombre de prix retenus pour la moyenne de référence
    - **Estimations & classements** : taille des classements « Top », seuil sous lequel une estimation s'affiche en "💩"
    - **Estimation en masse** : étiquette « TBD » (au choix parmi vos étiquettes), plages de valeur qui étiquettent automatiquement les cartes selon leur estimation, nombre d'essais par carte et délais d'attente de l'estimation
    - **Notifications & alertes** : seuil d'alerte de la pile de paquets, déclencheur de lueur rouge de fin d'enchère
  - **« Fonctionnalités »** : active/désactive individuellement chaque fonctionnalité du script
- **Tutoriels intégrés** : Un bouton « ❓ » juste à côté ouvre une modale avec de courtes explications pour les fonctionnalités du script
- **Liste de notifications agrandie** : Plus de place pour parcourir les notifications
- **Scroll automatique vers la dernière non lue** : Ouvrir le panneau de notifications défile directement jusqu'à la dernière notification non lue
- **Suivi de lecture intelligent** : Cliquer sur une notification marque aussi toutes celles plus anciennes comme lues, met à jour le compteur
- **Filtrer par type** : Des boutons 💰 🛒 🔨 ⭐ en haut du panneau permettent de filtrer les notifications
- **Suffixe de titre d'onglet** : Le titre de l'onglet du navigateur reflète le contenu de la page visitée

### 🎁 Paquets

- **Paquets pilotables au clavier** : Les flèches naviguent entre les cartes tirées (gauche-droite, haut-bas pour aller au début/à la fin), Espace ouvre/ferme le paquet, E ouvre la modale de carte, V ouvre la modale de vente, W ouvre la page Wikipédia de la carte
- **Notifications de pile** : Une notification push prévient quand les paquets s'accumulent (réglable) ; un interrupteur 🔔/🔕 permet de l'activer (désactivée par défaut)

### 📦 Collection

- **Actions rapides** : Un bouton pour ouvrir directement la modale d'enchère sur chaque carte
- **Tout sélectionner sauf étiquetées** : Sélectionne en un clic toutes les cartes non étiquetées de votre écran de collection
- **Estimations mémorisées** : Les estimations du marché dans la modale de vente sont mémorisées et affichées à côté de la rareté dans votre collection ("💩" sous un seuil réglable)
- **Évaluation en masse** : Deux boutons permettent d'agir sur les cartes de la page via la modale d'estimation — évaluer les seules cartes sans estimation, réévaluer toute la page ; un bouton « Arrêter la reconnaissance » permet d'interrompre une évaluation en cours ; les cartes marquées comme favorites, ou qui ne peuvent pas être mises aux enchères (déjà en vente, en échange…), sont ignorées, tout comme une carte qui n'obtient toujours pas d'estimation après le nombre d'essais choisi (3 par défaut, réglable dans la configuration), pour ne pas bloquer toute l'évaluation
- **Estimation en masse sur une collection** : Le bouton rouge « Estimer tout » répète l'évaluation des cartes sans estimation sur chaque page de la collection, en changeant de page automatiquement
  - ⚠️ Pour ces deux évaluations en masse, gardez l'onglet actif et la fenêtre non réduite pendant toute la durée : en arrière-plan, le navigateur ralentit les temporisations dont elles dépendent, ce qui les rend peu fiables
  - ⚠️ À cause de la façon dont les serveurs de WM fonctionnent, il est possible que cette estimation soit interrompue par une erreur serveur disant qu'il n'a trouvé aucune carte ou que l'affichage a pris trop de temps — c'est de la faute du site, on n'y peut rien.
- **Tri par prix** : Un bouton permet de trier les cartes de la page par prix croissant ou décroissant
- **Top de vos plus grosses cartes** : Un bouton « Top 40 » (réglable) à droite du titre ouvre en fondu une modale listant les plus grosses estimations mémorisées en trois colonnes ; un ✕ supprime une estimation du cache
- **Étiquetage pendant l'estimation en masse (désactivé par défaut)** : Les évaluations en masse étiquettent les cartes sans valeur déclarée sur le marché — à condition qu'elles n'aient encore aucune étiquette —, parfaitement configurable depuis les paramètres
- **Halo sur les cartes sans estimation** : Un interrupteur « Sans estimation » entoure d'un halo rouge clair les cartes de la page sans estimation (un « ? » compte comme une estimation)
- **Liste d'étiquettes lisible** : Plus de place pour afficher les étiquettes, et la liste se trie par ordre décroissant dès que les compteurs sont chargés ; à l'ouverture du filtre, le clavier navigue directement dans la liste (flèches, Début/Fin, saisie des premières lettres d'un nom)
- **Étiquettes au clavier** : Dans la modale d'une carte, Retour arrière dans le champ d'étiquette vide place le focus sur la croix de la dernière étiquette ; une fois celle-ci activée, le focus passe à l'étiquette précédente, puis revient au champ
- **Durée d'enchère par défaut** : À l'ouverture de la modale de vente d'une carte, le bouton de durée choisi dans le panneau de configuration est sélectionné automatiquement
- **Copier le nom d'une carte** : Un bouton 📋 à côté du nom, dans la modale de carte comme dans la modale d'enchère
- **Aller directement à une page** : Une fois le catalogue chargé, cliquer sur l'indicateur « Page X / Y » le remplace par un champ numérique ; Entrée mène à la page saisie en enchaînant les boutons précédent/suivant du site, Échap annule
- **Effacer la recherche** : Un bouton ✕ dans le champ de recherche de la collection vide son contenu
- **Modale d'étiquetage en masse retravaillée** : La modale d'application/retrait d'étiquette est plus large et affiche ses étiquettes en grille au lieu d'une colonne étroite ; la modale de retrait trie les filtres par ordre décroissant

### 🔄 Échanges

- **Échanges en deux colonnes** : Les onglets « Reçues », « Envoyées » et « Historique » s'affichent en deux colonnes plutôt qu'une seule liste, dès l'ouverture de l'onglet
- **Filtrer par utilisateur ou par carte** : Un champ de recherche au-dessus de l'historique filtre les échanges par nom de utilisateur ou par nom de carte présente dans l'échange
- **Total des estimations** : Dans le détail d'un échange, un total vert « (total X) » s'ajoute après « En échange de », somme des estimations mémorisées des cartes reçues

### 💰 Marché & Enchères

- **Onglet du marché par défaut** : L'arrivée ouvre automatiquement l'onglet choisi dans la configuration ; sur « Parcourir », le tri bascule sur « Fin imminente » dès que vous avez saisi ou collé une recherche et marqué une courte pause
- **Regroupement des enchères** : Bascule pour séparer « Mes enchères » en groupes « Surenchéri » / « Vous menez »
- **Alertes d'expiration** : Une notification push prévient qu'il reste 30 secondes sur une enchère ; un interrupteur 🔔/🔕 permet de l'activer (désactivée par défaut, par onglet)
- **Lueur rouge en fin d'enchère** : Le décompte « Se termine dans... » se met à luire en rouge quand il reste 15 secondes ou moins (seuil réglable)
- **Bouton de mise en rouge si vous menez** : Le bouton pour enchérir devient rouge clair quand vous êtes déjà le meilleur enchérisseur
- **Rechargement automatique si enchère introuvable** : Si la page affiche « Enchère introuvable », elle se recharge d'elle-même peu après
- **Suivi des prix de vente** : Enregistre le prix de vente des enchères vendues mais non possédées (réglable), puis signale le prix courant lors des visites suivantes comme **_légendaire_**, **_extraordinaire_**, **excellent**, **agréable**, **tolérable**, ou **_excessif_** par rapport à ceux que vous avez observés
  - **Sur vos propres ventes**, le tag juge la vente plutôt que l'achat : **excellente**, **agréable**, **tolérable** ou **décevante**
  - **Sur vos propres enchères remportées**, le tag affiche aussi le prix moyen de référence utilisé pour le calcul
  - Un indice de fiabilité accompagne le tag
  - Les prix enregistrés sont listés dans une grille sur votre propre profil, qu'un interrupteur déplie/replie
- **Enchères surveillées** : Gardez des enchères de côté pour les retrouver depuis le marché
  - Un bouton « 📌 Surveiller » sur la page d'une enchère (et une petite épingle posée sur le coin supérieur droit de chaque carte sur `/marketplace`) la surveille ; le bouton est désactivé une fois l'enchère terminée
  - Un bouton « 📌 Surveillées » sur `/marketplace` ouvre une liste de ces enchères, celles en cours d'abord ; un bouton « Ouvrir les enchères terminées » ouvre d'un coup toutes celles qui sont finies
  - Nettoyage automatique : une enchère terminée est retirée de la liste quand vous la visitez, et celles terminées depuis longtemps (réglable) sont retirées à chaque visite de votre profil
- **Flèches de prix sur le marché** : Sur `/marketplace`, dans les onglets « Parcourir » et « Mes enchères », une flèche colorée s'affiche à côté du prix des cartes dont vous avez déjà observé le prix, avec les mêmes seuils et couleurs que les étiquettes des pages d'enchère, en comparant le prix affiché — majoré de 10 % (le coût d'une nouvelle enchère) uniquement sur les cartes où vous êtes « Surenchéri » — : ▼ sous la valeur de référence, ▲ au-dessus ; un survol donne le détail
  - Sur l'onglet « Parcourir », un interrupteur « Cacher indésirables » masque les cartes qui ne sont pas dans votre liste de souhaits ; leurs noms sont mémorisés quand vous cliquez sur « Feuilleter (WMB) » sur /global-collection en mode liste de souhaits : le bouton parcourt pour vous toutes les pages
    - Une fois cette liste mémorisée, ajouter ou retirer une carte de votre liste de souhaits depuis sa modale sur /global-collection la met à jour automatiquement
  - Sur l'onglet « Parcourir », un interrupteur « ▲ Estomper », calé à droite de la rangée des filtres de rareté, atténue de moitié les cartes dont la flèche pointe vers le haut (prix pas intéressant) ; son état est mémorisé

### 📦 Catalogue

- **Nettoyage de la liste de souhaits** : Un bouton retire d'un coup toutes les cartes que vous possédez déjà de votre liste de souhaits ; quand le filtre « uniquement les cartes de ma liste de souhaits » est inactif, il n'affiche pas de nombre et se contente de fermer la fiche des cartes qui n'y figurent pas, sans jamais les ajouter

### 👤 Profil & Amis

- **Grille d'amis en 3 colonnes** : La liste d'amis est réorganisée en grille compacte, avec des boutons d'action réduits
- **Description des joueurs** : Un bouton « Description » sur le profil des autres joueurs permet de noter en quelques mots (max. 128 caractères) ; la description s'affiche ensuite à côté de leur pseudo
- **Accès rapide aux profils depuis la liste de souhaits** : Sur la collection globale, cliquer sur le nom d'un ami propriétaire d'une carte ouvre son profil
- **Suivre des joueurs** : Un bouton « Suivre » en forme d'œil sur le profil des joueurs. Un petit œil rouge s'affiche alors à côté de son pseudo sur les pages d'enchère, qu'il soit vendeur ou enchérisseur ; la liste des joueurs suivis s'affiche sur votre profil, avec un ✕ pour ne plus suivre
- **Mes plus grosses ventes et achats** : Vos 100 plus grosses ventes et vos 100 plus gros achats sont mémorisés, et la modale en affiche 40 par défaut (réglable ; changer ce réglage ne supprime rien) (depuis les pages d'enchère et les onglets « Historique » et « Gagnées » du marché) ; deux boutons sur votre profil les listent dans une modale, la première mise en avant par une lueur dorée, un ✕ retire une entrée du cache
- **Un bouton Exporter/Importer** permet de télécharger le cache du script (prix de vente, estimations, joueurs suivis et descriptions de joueurs) en fichier CSV, puis de le recharger sur un autre navigateur ou appareil ; l'import est strictement additif : il ne supprime ni n'écrase jamais rien d'utile dans votre cache actuel

### 🏆 Succès

- **Tout réclamer** : Un bouton additionne toutes les récompenses non réclamées et les réclame en une fois
- **Barres de progression repositionnées** : Sur `/achievements`, les barres de progression des succès sont placées en bas à droite de leur carte, sur la moitié de sa largeur

---

<br />

[Retour en haut](#top)
