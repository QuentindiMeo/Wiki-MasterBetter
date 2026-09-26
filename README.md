<div align="center" id="top">
  <h2>Wiki-MasterBetter</h2>
  <p>Une collection de fonctionnalités et d'ajustements pour améliorer l'expérience utilisateur sur WikiMasters</p>
</div>

<div align="center">
  <a href="#-description">Description</a> &#xa0; | &#xa0;
  <a href="#-installation">Installation</a> &#xa0; | &#xa0;
  <a href="#-fonctionnalités">Fonctionnalités</a> &#xa0; | &#xa0;
  <a href="#-utilisation">Utilisation</a>
</div>

&#xa0;

<div align="center">
  <a href="https://github.com/QuentindiMeo/Wiki-MasterBetter/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/QuentindiMeo/Wiki-MasterBetter?style=flat&color=%23ffe937&logo=github" /></a>
  <a href="https://github.com/QuentindiMeo/Wiki-MasterBetter/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/QuentindiMeo/Wiki-MasterBetter?color=forestgreen&logo=target" /></a>
</div>

&#xa0;

<div align="center">
  <b>Si ce script vous est utile, laissez une ⭐ sur le repo — ça aide à le faire connaître !</b>
  <br />
  Et si vous voulez m'offrir un café :&nbsp;
  <a href="https://ko-fi.com/quentindimeo">
    <img alt="ko-fi tip button" src="https://storage.ko-fi.com/cdn/brandasset/v2/support_me_on_kofi_blue.png" height="32px" />
  </a>
</div>

&#xa0;

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
- **Panneau de configuration** : Un bouton en forme de roue crantée, à côté de celui d'épinglage, ouvre une modale pour activer/désactiver individuellement chaque fonctionnalité du script (tout est activé par défaut) ; les choix sont sauvegardés dans `localStorage` et s'appliquent après rechargement de la page
- **Liste de notifications agrandie** : Plus de place pour parcourir les notifications
- **Scroll automatique vers la dernière non lue** : Ouvrir le panneau de notifications défile directement jusqu'à la dernière notification non lue
- **Suivi de lecture intelligent** : Cliquer sur une notification marque aussi toutes celles plus anciennes comme lues, met à jour le compteur
- **Suffixe de titre d'onglet** : Le titre de l'onglet du navigateur reflète le contenu de la page visitée

### 💰 Marché & Enchères

- **Onglet « Mes enchères » par défaut** : L'arrivée sur le marché ouvre automatiquement cet onglet
- **Regroupement des enchères** : Bascule pour séparer « Mes enchères » en groupes « Surenchéri » / « Vous menez »
- **Alertes d'expiration** : Une notification push se déclenche quand il reste 30 secondes sur une enchère
- **Bouton retour plus clair** : Relabellisé « Retour en arrière » sur les pages d'enchère
- **Liens de profil des enchérisseurs** : Un lien « @ » à côté du nom de chaque enchérisseur ouvre son profil dans un nouvel onglet
- **Suivi des prix de vente** : Enregistre le prix de vente des enchères vendues (jusqu'à 5 prix les moins chers observés) par carte, puis signale le prix courant lors des visites suivantes comme **_SNIPABLE_**, **agréable**, **tolérable**, ou **_overpriced_** par rapport à cette moyenne
  - Les prix enregistrés sont listés dans une grille effaçable sur votre propre profil
  - Un bouton Exporter/Importer permet de copier-coller ce cache (prix de vente et estimations) vers un autre navigateur ou appareil

### 📦 Collection

- **Actions rapides** : Un bouton sur chaque carte de la collection ouvre la modale d'enchère
- **Tout sélectionner sauf étiquetées** : Sélectionne en un clic toutes les cartes non étiquetées de votre écran de collection
- **Estimations mémorisées** : Le prix d'estimation vu sur `/pulls` ou `/collection` est mémorisé et affiché à côté de la rareté de chaque carte de la collection
- **Évaluation en masse** : Trois boutons permettent d'agir sur les cartes de la page via la modale d'estimation — évaluer les seules cartes sans estimation (avec une estimation du temps restant), réévaluer toute la page, ou trier la page par prix décroissant ; un bouton « Arrêter la reconnaissance » permet d'interrompre une évaluation en cours

### 🎁 Pulls

- **Paquets pilotables au clavier** : Les flèches naviguent entre les cartes tirées, Espace ouvre/ferme le paquet, E ouvre la modale de carte, V ouvre la modale de vente
- **Notifications de pile** : Une notification push prévient quand les paquets s'accumulent

### 👤 Profil & Amis

- **Grille d'amis en 3 colonnes** : La liste d'amis est réorganisée en grille compacte, avec des boutons d'action réduits à leur icône
- **Accès rapide aux profils depuis la liste de souhaits** : Sur la collection globale, cliquer sur le nom d'un ami propriétaire d'une carte ouvre son profil

### 🏆 Hauts faits

- **Tout réclamer** : Un bouton additionne toutes les récompenses non réclamées et les réclame en une fois

## 📖 Utilisation

1. Naviguez sur [wiki-masters.com](https://www.wiki-masters.com) comme d'habitude — chaque ajustement s'applique automatiquement
2. La permission de notifications peut être demandée pour les fonctionnalités de notification push (paquets qui s'accumulent, enchère bientôt expirée)
3. Certaines données (préférence de navbar repliée, regroupement des enchères, suivi des prix de vente) persistent d'une visite à l'autre via le stockage de Tampermonkey et `localStorage`

---

<br />

[Retour en haut](#top)
