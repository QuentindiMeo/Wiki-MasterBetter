<div align="center" id="top">
  <img src="./wikimasterbetter-logo.svg" alt="Wiki-MasterBetter" width="120" height="120" />
  <h2>Wiki-MasterBetter</h2>
  <p>Une collection de fonctionnalités et d'ajustements pour améliorer l'expérience utilisateur sur WikiMasters</p>
</div>

<div align="center">
  <a href="#-description">Description</a> &#xa0; | &#xa0;
  <a href="#-installation">Installation</a> &#xa0; | &#xa0;
  <a href="#-fonctionnalités">Fonctionnalités</a> &#xa0; | &#xa0;
  <a href="#-utilisation">Utilisation</a>
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
4. Rendez-vous sur [wiki-masters.com](https://www.wiki-masters.com) — le script s'active automatiquement

## 🎯 Fonctionnalités

Je ne liste que celles qui change quelque chose de significatif pour l'utilisateur.

### 🔔 Barre de navigation & Notifications

- **Barre de navigation repliable** : Se replie en icônes par défaut, se déplie en douceur au survol — ou épinglez-la grâce au bouton en haut de la barre
- **Panneau de configuration** : Un bouton à roue crantée, à côté de celui d'épinglage, ouvre une modale pour activer/désactiver individuellement chaque fonctionnalité du script ; les choix sont sauvegardés dans votre cache de navigateur
- **Tutoriels intégrés** : Un bouton « ❓ » juste à côté ouvre une modale avec de courtes explications pour les fonctionnalités les moins évidentes du script
- **Liste de notifications agrandie** : Plus de place pour parcourir les notifications
- **Scroll automatique vers la dernière non lue** : Ouvrir le panneau de notifications défile directement jusqu'à la dernière notification non lue
- **Suivi de lecture intelligent** : Cliquer sur une notification marque aussi toutes celles plus anciennes comme lues, met à jour le compteur
- **Filtrer par type** : Des boutons 💰 🛒 🔨 ⭐ en haut du panneau permettent de filtrer les notifications
- **Suffixe de titre d'onglet** : Le titre de l'onglet du navigateur reflète le contenu de la page visitée

### 🎁 Paquets

- **Paquets pilotables au clavier** : Les flèches naviguent entre les cartes tirées (gauche-droite, haut-bas pour aller au début/à la fin), Espace ouvre/ferme le paquet, E ouvre la modale de carte, V ouvre la modale de vente, W ouvre la page Wikipédia de la carte
- **Notifications de pile** : Une notification push prévient quand les paquets s'accumulent ; un interrupteur 🔔/🔕 permet de l'activer (désactivée par défaut)

### 📦 Collection

- **Actions rapides** : Un bouton pour ouvrir directement la modale d'enchère sur chaque carte
- **Tout sélectionner sauf étiquetées** : Sélectionne en un clic toutes les cartes non étiquetées de votre écran de collection
- **Estimations mémorisées** : Les estimations du marché dans la modale de vente sont mémorisées et affichées à côté de la rareté dans votre collection
- **Évaluation en masse** : Deux boutons permettent d'agir sur les cartes de la page via la modale d'estimation — évaluer les seules cartes sans estimation, réévaluer toute la page ; un bouton « Arrêter la reconnaissance » permet d'interrompre une évaluation en cours
- **Estimation en masse sur une collection** : Le bouton rouge « Estimation complète » répète l'évaluation des cartes sans estimation sur chaque page de la collection, en changeant de page automatiquement ; son libellé indique une durée minimale en minutes, d'après le nombre de pages restantes
  - ⚠️ Pour ces deux évaluations en masse, gardez l'onglet actif et la fenêtre non réduite pendant toute la durée : en arrière-plan, le navigateur ralentit les temporisations dont elles dépendent, ce qui les rend peu fiables
- **Tri par prix décroissant** : Un bouton permet de trier les cartes de la page par prix décroissant, pour repérer rapidement les plus chères
- **Top 40 des estimations** : Un bouton « Top 40 » à droite du titre ouvre en fondu une modale listant les 40 plus grosses estimations mémorisées en trois colonnes, la première mise en avant par une lueur dorée pulsante ; un ✕ supprime une estimation du cache
- **Halo sur les cartes sans estimation** : Un interrupteur « Sans estimation » après le bouton « Top 40 » entoure d'un halo rouge clair les cartes de la page sans estimation (un « ? » compte comme une estimation) ; son état est mémorisé
- **Rechargement automatique en cas d'échec** : Si la page affiche un message rouge « a échoué », elle se recharge d'elle-même peu après
- **Liste d'étiquettes lisible** : Plus de place pour afficher les étiquettes, et la liste se trie par ordre décroissant dès que les compteurs sont chargés ; à l'ouverture du filtre, le clavier navigue directement dans la liste (flèches, Début/Fin, saisie des premières lettres d'un nom)
- **Copier le nom d'une carte** : Un bouton 📋 à côté du nom, dans la modale de carte comme dans la modale d'enchère
- **Aller directement à une page** : Une fois le catalogue chargé, cliquer sur l'indicateur « Page X / Y » le remplace par un champ numérique ; Entrée mène à la page saisie en enchaînant les boutons précédent/suivant du site, Échap annule
- **Effacer la recherche** : Un bouton ✕ dans le champ de recherche de la collection vide son contenu
- **Modale d'étiquetage en masse retravaillée** : La modale d'application/retrait d'étiquette est plus large et affiche ses étiquettes en grille au lieu d'une colonne étroite ; la modale de retrait trie les filtres par ordre décroissant

### 🔄 Échanges

- **Historique en deux colonnes** : L'onglet « Historique » s'affiche en deux colonnes flexibles qui s'adaptent à la hauteur de chaque échange, plutôt qu'une seule liste
- **Filtrer par partenaire** : Un champ de recherche au-dessus de l'historique filtre les échanges par nom de partenaire

### 💰 Marché & Enchères

- **Onglet « Mes enchères » par défaut** : L'arrivée ouvre automatiquement cet onglet
- **Regroupement des enchères** : Bascule pour séparer « Mes enchères » en groupes « Surenchéri » / « Vous menez »
- **Alertes d'expiration** : Une notification push prévient qu'il reste 30 secondes sur une enchère ; un interrupteur 🔔/🔕 permet de l'activer (désactivée par défaut, par onglet)
- **Lueur rouge en fin d'enchère** : Le décompte « Se termine dans... » se met à luire en rouge quand il reste moins de 10 secondes
- **Bouton de mise en rouge si vous menez** : Le bouton pour enchérir devient rouge clair quand vous êtes déjà le meilleur enchérisseur
- **Liens de profil de la salle de vente** : Un lien « @ » à côté du nom de chaque enchérisseur, et du vendeur
- **Rechargement automatique si enchère introuvable** : Si la page affiche « Enchère introuvable », elle se recharge d'elle-même peu après
- **Suivi des prix de vente** : Enregistre le prix de vente des enchères vendues mais non possédées par carte, puis signale le prix courant lors des visites suivantes comme **_légendaire_**, **_extraordinaire_**, **excellent**, **agréable**, **tolérable**, ou **_excessif_** par à ceux que vous avez observés
  - **Sur vos propres ventes**, le tag juge la vente plutôt que l'achat : **excellente**, **agréable**, **tolérable** ou **décevante**
  - **Sur vos propres enchères remportées**, le tag affiche aussi le prix moyen de référence utilisé pour le calcul
  - Un indice de fiabilité accompagne le tag
  - Les prix enregistrés sont listés dans une grille sur votre propre profil
  - Un bouton Exporter/Importer permet de télécharger ce cache (prix de vente, estimations et joueurs suivis) en fichier CSV, puis de le recharger sur un autre navigateur ou appareil
- **Mes plus grosses ventes et achats** : Les 40 plus grosses ventes et les 40 plus gros achats sont mémorisés (depuis les pages d'enchère et les onglets « Historique » et « Gagnées » du marché) ; deux boutons sur votre profil les listent dans une modale, la première mise en avant par une lueur dorée, un ✕ retire une entrée du cache

### 📦 Catalogue

- **Nettoyage de la liste de souhaits** : Quand le filtre « uniquement les cartes de ma liste de souhaits » est actif, un bouton retire d'un coup toutes celles que vous possédez déjà

### 👤 Profil & Amis

- **Grille d'amis en 3 colonnes** : La liste d'amis est réorganisée en grille compacte, avec des boutons d'action réduits à leur icône
- **Accès rapide aux profils depuis la liste de souhaits** : Sur la collection globale, cliquer sur le nom d'un ami propriétaire d'une carte ouvre son profil
- **Suivre des joueurs** : Un bouton « Suivre » en forme d'œil sur le profil des joueurs. Un petit œil rouge s'affiche alors à côté de son pseudo sur les pages d'enchère, qu'il soit vendeur ou enchérisseur ; la liste des joueurs suivis s'affiche sur votre profil, avec un ✕ pour ne plus suivre

### 🏆 Succès

- **Tout réclamer** : Un bouton additionne toutes les récompenses non réclamées et les réclame en une fois

## 📖 Utilisation

1. Naviguez sur [wiki-masters.com](https://www.wiki-masters.com) comme d'habitude — chaque ajustement s'applique automatiquement
2. La permission de notifications peut être demandée pour les fonctionnalités de notification push (paquets qui s'accumulent, enchère bientôt expirée)
3. Certaines données (préférence de navbar repliée, regroupement des enchères, suivi des prix de vente) persistent d'une visite à l'autre via le stockage de Tampermonkey et `localStorage`

---

<br />

[Retour en haut](#top)
