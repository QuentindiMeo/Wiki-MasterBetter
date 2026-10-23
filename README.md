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

Un script local Tampermonkey qui ajoute une couche d'ajustements de confort, de raccourcis et de petites automatisations sur [wiki-masters.com](https://www.wiki-masters.com) — navbar repliable, notifications plus intelligentes, pulls pilotables au clavier, suivi des prix du marché, et bien plus.

## 🚀 Installation

1. Installez [Tampermonkey](https://www.tampermonkey.net/) (ou un gestionnaire de scripts local compatible) dans votre navigateur
2. Ouvrez le tableau de bord de Tampermonkey et créez un nouveau script
3. Collez le contenu de [`wiki-masterbetter.me.js`](./wiki-masterbetter.me.js) et enregistrez
4. Rendez-vous sur [wiki-masters.com](https://www.wiki-masters.com) — le script s'active automatiquement (rafraîchissez la page si elle était déjà ouverte)

## 📖 Utilisation

1. Naviguez sur [wiki-masters.com](https://www.wiki-masters.com) comme d'habitude — chaque ajustement s'applique automatiquement
2. La permission de notifications peut être demandée pour les fonctionnalités de notification push (paquets qui s'accumulent, enchère bientôt expirée)
3. Certaines données (préférence de navbar repliée, regroupement des enchères, suivi des prix de vente) persistent d'une visite à l'autre via le stockage de Tampermonkey et `localStorage`
4. Ouvrez votre profil une première fois : votre pseudo WikiMasters est détecté automatiquement (visible, en lecture seule, dans ⚙️ › Configuration › « Compte », avec une croix ✕ pour le réinitialiser), ce qui active toutes les fonctionnalités liées à vos ventes et à vos enchères

## 🎯 Fonctionnalités

Je ne liste que celles qui change quelque chose de significatif pour l'utilisateur.

### 🔔 Barre de navigation & Notifications

- **Barre de navigation repliable** : Se replie en icônes par défaut, se déplie en douceur au survol — ou épinglez-la grâce au bouton en haut de la barre
- **Panneau de configuration** : Un bouton à roue crantée, à côté de celui d'épinglage, ouvre une modale à deux onglets ; les choix sont sauvegardés dans votre cache de navigateur dès que vous les faites, sans recharger la page
  - **« Configuration »** (affiché en premier) : des réglages à choisir d'un clic parmi quelques valeurs, rangés par thème — les valeurs de départ sont celles que le script utilisait avant :
    - **Compte** : votre pseudo WikiMasters, détecté tout seul à la première ouverture de votre profil (affiché en lecture seule)
    - **Enchères & marché** : durée d'enchère par défaut (1 h), délai de suppression automatique des enchères surveillées (7 jours), onglet du marché ouvert à l'arrivée (« Mes enchères »)
    - **Prix de vente observés** : nombre de prix gardés par carte (7) et nombre de prix retenus pour la moyenne de référence (5, jamais plus que le précédent)
    - **Estimations & classements** : taille des classements « Top » (40), seuil sous lequel une estimation s'affiche en 💩 (10)
    - **Estimation en masse** : nombre d'essais par carte (3) et délais d'attente de l'estimation (8 s / 20 s)
    - **Notifications & alertes** : seuil d'alerte de la pile de paquets (90 %), seuil de la lueur rouge de fin d'enchère (15 s)
  - **« Fonctionnalités »** : active/désactive individuellement chaque fonctionnalité du script (un rechargement est nécessaire)
- **Tutoriels intégrés** : Un bouton « ❓ » juste à côté ouvre une modale avec de courtes explications pour les fonctionnalités les moins évidentes du script
- **Liste de notifications agrandie** : Plus de place pour parcourir les notifications
- **Scroll automatique vers la dernière non lue** : Ouvrir le panneau de notifications défile directement jusqu'à la dernière notification non lue
- **Suivi de lecture intelligent** : Cliquer sur une notification marque aussi toutes celles plus anciennes comme lues, met à jour le compteur
- **Filtrer par type** : Des boutons 💰 🛒 🔨 ⭐ en haut du panneau permettent de filtrer les notifications
- **Suffixe de titre d'onglet** : Le titre de l'onglet du navigateur reflète le contenu de la page visitée

### 🎁 Paquets

- **Paquets pilotables au clavier** : Les flèches naviguent entre les cartes tirées (gauche-droite, haut-bas pour aller au début/à la fin), Espace ouvre/ferme le paquet, E ouvre la modale de carte, V ouvre la modale de vente, W ouvre la page Wikipédia de la carte
- **Notifications de pile** : Une notification push prévient quand les paquets s'accumulent (à partir de 90 % de la pile par défaut, réglable dans la configuration) ; un interrupteur 🔔/🔕 permet de l'activer (désactivée par défaut)

### 📦 Collection

- **Actions rapides** : Un bouton pour ouvrir directement la modale d'enchère sur chaque carte
- **Tout sélectionner sauf étiquetées** : Sélectionne en un clic toutes les cartes non étiquetées de votre écran de collection
- **Estimations mémorisées** : Les estimations du marché dans la modale de vente sont mémorisées et affichées à côté de la rareté dans votre collection (💩 sous un seuil réglable dans la configuration)
- **Évaluation en masse** : Deux boutons permettent d'agir sur les cartes de la page via la modale d'estimation — évaluer les seules cartes sans estimation, réévaluer toute la page ; un bouton « Arrêter la reconnaissance » permet d'interrompre une évaluation en cours ; les cartes marquées comme favorites, ou qui ne peuvent pas être mises aux enchères (déjà en vente, en échange…), sont ignorées, tout comme une carte qui n'obtient toujours pas d'estimation après le nombre d'essais choisi (3 par défaut, réglable dans la configuration), pour ne pas bloquer toute l'évaluation
- **Estimation en masse sur une collection** : Le bouton rouge « Estimation complète » répète l'évaluation des cartes sans estimation sur chaque page de la collection, en changeant de page automatiquement ; son libellé indique une durée minimale en minutes, d'après le nombre de pages restantes
  - ⚠️ Pour ces deux évaluations en masse, gardez l'onglet actif et la fenêtre non réduite pendant toute la durée : en arrière-plan, le navigateur ralentit les temporisations dont elles dépendent, ce qui les rend peu fiables
- **Tri par prix décroissant** : Un bouton permet de trier les cartes de la page par prix décroissant, pour repérer rapidement les plus chères
- **Top 40 des estimations** : Un bouton « Top 40 » (la taille est réglable dans l'onglet Configuration, 40 par défaut) à droite du titre ouvre en fondu une modale listant les 40 plus grosses estimations mémorisées en trois colonnes, la première mise en avant par une lueur dorée pulsante ; un ✕ supprime une estimation du cache ; le dernier résultat est gardé en mémoire pour que la modale s'affiche instantanément, puis remplacé dès que le recalcul est terminé
- **Étiquetage « TBD » (désactivée par défaut)** : Les évaluations en masse étiquettent « TBD » les cartes sans valeur déclarée sur le marché — à condition qu'elles n'aient encore aucune étiquette
- **Halo sur les cartes sans estimation** : Un interrupteur « Sans estimation » après le bouton « Top 40 » entoure d'un halo rouge clair les cartes de la page sans estimation (un « ? » compte comme une estimation) ; son état est mémorisé
- **Liste d'étiquettes lisible** : Plus de place pour afficher les étiquettes, et la liste se trie par ordre décroissant dès que les compteurs sont chargés ; à l'ouverture du filtre, le clavier navigue directement dans la liste (flèches, Début/Fin, saisie des premières lettres d'un nom)
- **Durée d'enchère par défaut** : À l'ouverture de la modale de vente d'une carte, le bouton de durée choisi dans le panneau de configuration est sélectionné automatiquement
- **Copier le nom d'une carte** : Un bouton 📋 à côté du nom, dans la modale de carte comme dans la modale d'enchère
- **Aller directement à une page** : Une fois le catalogue chargé, cliquer sur l'indicateur « Page X / Y » le remplace par un champ numérique ; Entrée mène à la page saisie en enchaînant les boutons précédent/suivant du site, Échap annule
- **Effacer la recherche** : Un bouton ✕ dans le champ de recherche de la collection vide son contenu
- **Modale d'étiquetage en masse retravaillée** : La modale d'application/retrait d'étiquette est plus large et affiche ses étiquettes en grille au lieu d'une colonne étroite ; la modale de retrait trie les filtres par ordre décroissant

### 🔄 Échanges

- **Historique en deux colonnes** : L'onglet « Historique » s'affiche en deux colonnes flexibles qui s'adaptent à la hauteur de chaque échange, plutôt qu'une seule liste
- **Filtrer par partenaire** : Un champ de recherche au-dessus de l'historique filtre les échanges par nom de partenaire

### 💰 Marché & Enchères

- **Onglet du marché par défaut configurable** : L'arrivée ouvre automatiquement l'onglet choisi dans la configuration (« Mes enchères » par défaut, ou « Parcourir », « Historique », « Gagnées », « Aucun ») ; sur « Parcourir », le tri bascule sur « Fin imminente » dès que vous commencez à saisir une recherche
- **Regroupement des enchères** : Bascule pour séparer « Mes enchères » en groupes « Surenchéri » / « Vous menez »
- **Alertes d'expiration** : Une notification push prévient qu'il reste 30 secondes sur une enchère ; un interrupteur 🔔/🔕 permet de l'activer (désactivée par défaut, par onglet)
- **Lueur rouge en fin d'enchère** : Le décompte « Se termine dans... » se met à luire en rouge quand il reste 15 secondes ou moins (seuil réglable dans la configuration : 5, 10, 15 par défaut ou 30 secondes)
- **Bouton de mise en rouge si vous menez** : Le bouton pour enchérir devient rouge clair quand vous êtes déjà le meilleur enchérisseur
- **Rechargement automatique si enchère introuvable** : Si la page affiche « Enchère introuvable », elle se recharge d'elle-même peu après
- **Suivi des prix de vente** : Enregistre le prix de vente des enchères vendues mais non possédées (jusqu'à 7 prix par carte, dont les 5 moins chers servent au calcul de la référence ; les deux nombres sont réglables dans la configuration), puis signale le prix courant lors des visites suivantes comme **_légendaire_**, **_extraordinaire_**, **excellent**, **agréable**, **tolérable**, ou **_excessif_** par rapport à ceux que vous avez observés
  - **Sur vos propres ventes**, le tag juge la vente plutôt que l'achat : **excellente**, **agréable**, **tolérable** ou **décevante**
  - **Sur vos propres enchères remportées**, le tag affiche aussi le prix moyen de référence utilisé pour le calcul
  - Un indice de fiabilité accompagne le tag
  - Les prix enregistrés sont listés dans une grille sur votre propre profil, qu'un interrupteur déplie/replie
- **Enchères surveillées** : Gardez des enchères de côté pour les retrouver depuis le marché
  - Un bouton « 📌 Surveiller » sur la page d'une enchère (et une petite épingle en haut à droite de chaque carte de `/marketplace`) la surveille ; recliquer arrête la surveillance. Enchérir sur une enchère la surveille aussi automatiquement
  - Un bouton « 📌 Surveillées » sur `/marketplace` ouvre une liste de ces enchères, celles en cours d'abord (la plus proche de sa fin en tête), avec le temps restant, pour y retourner d'un clic ; une pastille « Ouvrir les enchères terminées (n) » ouvre d'un coup toutes celles qui sont finies, dans de nouveaux onglets
  - Nettoyage automatique : une enchère terminée est retirée de la liste quand vous la visitez, et celles terminées depuis plus longtemps que le délai choisi dans la configuration (7 jours par défaut) sont retirées à chaque visite de votre profil
- **Flèches de prix sur le marché** : Sur `/marketplace`, dans les onglets « Parcourir » et « Mes enchères », une flèche colorée s'affiche à côté du prix des cartes dont vous avez déjà observé le prix, avec les mêmes seuils et couleurs que les étiquettes des pages d'enchère, en comparant le prix affiché — majoré de 10 % (le coût d'une nouvelle enchère) uniquement sur les cartes où vous êtes « Surenchéri » — : ▼ sous la valeur de référence, ▲ au-dessus ; un survol donne le détail

### 📦 Catalogue

- **Nettoyage de la liste de souhaits** : Un bouton retire d'un coup toutes les cartes que vous possédez déjà de votre liste de souhaits ; quand le filtre « uniquement les cartes de ma liste de souhaits » est inactif, il n'affiche pas de nombre et se contente de fermer la fiche des cartes qui n'y figurent pas, sans jamais les ajouter

### 👤 Profil & Amis

- **Grille d'amis en 3 colonnes** : La liste d'amis est réorganisée en grille compacte, avec des boutons d'action réduits
- **Description des joueurs** : Un bouton « Description » sur le profil des autres joueurs permet de noter en quelques mots (max. 128 caractères) ; la description s'affiche à côté de leur pseudo sur leur profil et sur la page des amis, et sous leur pseudo dans la liste des joueurs suivis
- **Accès rapide aux profils depuis la liste de souhaits** : Sur la collection globale, cliquer sur le nom d'un ami propriétaire d'une carte ouvre son profil
- **Suivre des joueurs** : Un bouton « Suivre » en forme d'œil sur le profil des joueurs. Un petit œil rouge s'affiche alors à côté de son pseudo sur les pages d'enchère, qu'il soit vendeur ou enchérisseur ; la liste des joueurs suivis s'affiche sur votre profil, avec un ✕ pour ne plus suivre
- **Mes plus grosses ventes et achats** : Les 40 plus grosses ventes et les 40 plus gros achats (taille réglable dans l'onglet Configuration, 40 par défaut) sont mémorisés (depuis les pages d'enchère et les onglets « Historique » et « Gagnées » du marché) ; deux boutons sur votre profil les listent dans une modale, la première mise en avant par une lueur dorée, un ✕ retire une entrée du cache
- **Un bouton Exporter/Importer** permet de télécharger le cache du script (prix de vente, estimations, joueurs suivis et descriptions de joueurs) en fichier CSV, puis de le recharger sur un autre navigateur ou appareil ; l'import est strictement additif : il ne supprime ni n'écrase jamais rien d'utile dans votre cache actuel

### 🏆 Succès

- **Tout réclamer** : Un bouton additionne toutes les récompenses non réclamées et les réclame en une fois
- **Barres de progression repositionnées** : Sur `/achievements`, les barres de progression des succès sont placées en bas à droite de leur carte, sur la moitié de sa largeur

---

<br />

[Retour en haut](#top)
