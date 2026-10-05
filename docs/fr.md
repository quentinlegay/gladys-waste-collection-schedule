# Collecte des déchets

Cette intégration connaît vos jours de collecte des déchets et les met à
disposition de Gladys : des capteurs pour vos scènes (« sortir la poubelle
ce soir »), et un widget de tableau de bord avec les prochaines collectes.

Les jours viennent de **deux sources**, au choix :

- **un fournisseur** : le service de collecte publie lui-même son calendrier,
  jours fériés compris. C'est la source la plus fiable ;
- **votre propre planning**, décrit en toutes lettres (« mardi », « lundi
  semaines paires »…). Il fonctionne partout, en attendant que votre
  collectivité soit prise en charge par un fournisseur.

## Fournisseurs disponibles

| Fournisseur                                | Territoire                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **SMICTOM Valcobreizh**                    | Val d'Ille-Aubigné, Bretagne Romantique, Liffré-Cormier, Couesnon-Marches de Bretagne, Saint-Méen-Montauban (52 communes, 35) |
| **Autre collectivité utilisant Publidata** | Toute collectivité dont le site « info déchets » ou l'application tourne sur Publidata (voir plus bas)                        |

Toutes les communes du **Val d'Ille-Aubigné** (Melesse, La Mézière, Saint-Aubin
d'Aubigné, Aubigné, Guipel…) sont collectées par le SMICTOM Valcobreizh :
choisissez « SMICTOM Valcobreizh ».

## Configuration avec un fournisseur

1. Vérifiez que votre maison est **placée sur la carte** dans Gladys
   (**Paramètres → Maisons**). À l'installation, l'intégration demande
   l'accès à cette position : c'est elle qui donne votre adresse.
2. Dans l'onglet **Configuration** de l'intégration, choisissez votre
   fournisseur dans **Source du planning**.
3. Enregistrez, puis cliquez sur **Afficher le planning** : le message
   affiche la **maison utilisée**, l'**adresse reconnue** à sa position et
   les prochains jours de chaque type de déchet.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils.

Une même commune peut avoir plusieurs secteurs de collecte (bourg, hameaux,
certaines rues) : c'est l'adresse qui permet de trouver le bon. Si l'adresse
reconnue n'est pas la vôtre (maison mal placée sur la carte), corrigez la
position dans Gladys.

**Plusieurs maisons ?** Par défaut, la première maison (par ordre
alphabétique) qui a une position est utilisée. Pour en choisir une autre,
saisissez son **nom** dans le champ **Maison (si plusieurs)** ; l'aperçu du
planning liste vos maisons. Gladys ne permet pas encore à une intégration de
proposer les maisons dans une liste déroulante, d'où ce champ texte.

**Saisir une adresse à la place.** Le champ **Adresse** (numéro, rue, code
postal et commune, par exemple `1 rue de la Mairie 35250 Aubigné`) est
prioritaire sur la maison : utile pour un autre lieu, ou si la position de
la maison ne convient pas. Si l'adresse n'est pas reconnue, ajoutez le
**code INSEE** de la commune (à ne pas confondre avec le code postal ;
Aubigné : 35007).

Le calendrier du fournisseur est retéléchargé toutes les 6 heures. En cas de
panne réseau, les dernières données reçues restent utilisées (elles sont
conservées même après un redémarrage) et un message l'indique dans l'onglet
Configuration.

Les jours fériés sont **déjà pris en compte** par le fournisseur : le
14 juillet 2026 tombant un mardi, la collecte des ordures ménagères
d'Aubigné passe au mercredi 15, sans rien à configurer.

### Autre collectivité utilisant Publidata

Publidata fait tourner les sites « info déchets » et applications de
nombreuses collectivités (Métropole Européenne de Lille, Orléans Métropole,
Tours Métropole, Grand Nancy, Le Cotentin, Le Havre Seine Métropole…). Pour
utiliser la vôtre :

1. ouvrez le site « info déchets » de votre collectivité dans un navigateur
   d'ordinateur, puis les outils de développement (touche F12), onglet
   **Réseau** ;
2. saisissez une adresse dans le widget et filtrez les requêtes sur
   `api.publidata` ;
3. le nombre après `instances[]=` est l'**identifiant d'instance** (1003 pour
   Valcobreizh) : reportez-le dans le champ **Identifiant d'instance
   Publidata** et choisissez « Autre collectivité utilisant Publidata ».

## Configuration avec votre propre planning

Choisissez **Mon propre planning**, puis décrivez chaque type de déchet en
toutes lettres. Laissez vide un type qui n'est pas collecté chez vous.

| Ce que vous écrivez                                    | Signification                                        |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `mardi`                                                | tous les mardis                                      |
| `lundi et jeudi`                                       | deux fois par semaine                                |
| `lundi semaines paires`                                | le lundi des semaines paires (numéro de semaine ISO) |
| `jeudi semaines impaires`                              | le jeudi des semaines impaires                       |
| `vendredi toutes les 2 semaines depuis le 09/01/2026`  | un vendredi sur deux, à partir d'une collecte connue |
| `vendredi une semaine sur deux à partir du 09/01/2026` | idem                                                 |
| `1er et 3e mercredi`                                   | le 1er et le 3e mercredi de chaque mois              |
| `dernier vendredi`                                     | le dernier vendredi de chaque mois                   |
| `mercredi de mars à novembre`                          | seulement certains mois                              |
| `samedi en juillet et août`                            | idem                                                 |
| `mardi jusqu'au 31/12/2026`                            | jusqu'à une date                                     |
| `14/11/2026, 12/12/2026`                               | des jours précis (encombrants, sapins…)              |
| `mardi ; 1er samedi`                                   | plusieurs règles, séparées par `;`                   |

Les dates s'écrivent `09/01/2026` ou `2026-01-09`. Les heures (« à partir
de 11h ») sont acceptées et ignorées : vous pouvez copier-coller la phrase du
site de votre collectivité. L'anglais fonctionne aussi (`every other friday
from 2026-01-09`). Les utilisateurs avancés peuvent écrire la syntaxe
OpenStreetMap `opening_hours` (`week 02-53/2 Mo`).

**Semaines paires ou « une semaine sur deux » ?** Si votre collectivité
parle de semaines paires/impaires, utilisez-les. Sinon, préférez « toutes
les 2 semaines depuis » une date de collecte connue : c'est plus sûr en fin
d'année, quand l'année compte 53 semaines (comme 2026).

Le bouton **Tester une règle** affiche les prochains jours d'une règle
sans l'enregistrer, et explique ce qui n'est pas compris.

### Jours fériés

Le réglage **Jours fériés** indique comment votre planning réagit aux 11 jours
fériés nationaux :

- **le jour férié et les jours suivants de la semaine sont décalés d'un
  jour** (par défaut, le cas le plus courant) : un lundi férié, la collecte
  du lundi passe au mardi, celle du mardi au mercredi… jusqu'au samedi ;
- **seule la collecte du jour férié est décalée au lendemain** ;
- **pas de collecte les jours fériés** ;
- **collecte maintenue les jours fériés**.

Les jours fériés propres à l'Alsace-Moselle (Vendredi saint, 26 décembre) ne
sont pas pris en compte : ajoutez une exception.

### Compléter un fournisseur

Avec un fournisseur, les règles de votre planning **complètent** les types
qu'il ne fournit pas (par exemple une collecte du verre organisée par votre
mairie). Elles ne remplacent jamais un type fourni.

## Exceptions

Le champ **Exceptions** corrige un jour à la main, quelle que soit la source :

- `25/12/2026 > 26/12/2026` déplace une collecte ;
- `-01/01/2027` annule une collecte ;
- `+31/12/2026` ajoute une collecte.

Sans préfixe, l'exception vaut pour tous les types. Pour n'en viser qu'un,
préfixez par son code : `omr:` (ordures ménagères), `emb:` (emballages),
`verre:`, `papier:`, `bio:` (biodéchets), `dv:` (déchets verts), `enc:`
(encombrants). Séparez les exceptions par `;` :

```
omr: 25/12/2026 > 26/12/2026 ; emb: -01/01/2027 ; enc: +14/11/2026
```

## Appareils

L'onglet **Découverte** propose :

- **Prochaine collecte** : la prochaine collecte, tous types confondus ;
- un appareil **Collecte …** par type de déchet (ordures ménagères,
  emballages…).

Chacun porte deux capteurs :

- **Jours avant la collecte** : `0` = aujourd'hui, `1` = demain, `2` =
  après-demain… (`400` quand aucune collecte n'est prévue) ;
- **Prochaine collecte** : la date en toutes lettres, par exemple
  « mardi 6 octobre 2026 » (précédée des types sur l'appareil « Prochaine
  collecte »).

Les valeurs sont mises à jour chaque minute : le compteur change au plus
une minute après minuit.

## Notifications : le déclencheur « Rappel de collecte »

L'intégration ajoute un déclencheur de scène **Rappel de collecte des
déchets**. Dans **Scènes → Nouvelle scène**, choisissez-le, puis réglez :

- **Type de déchet** : un type précis (ordures ménagères, emballages…), ou
  **Toutes les collectes** : un seul déclenchement par jour de collecte, qui
  liste tous les types du jour (pas de double notification quand les
  ordures et les emballages passent le même jour) ;
- **Quand** : la veille à 17h, 18h, 19h, 20h, 21h ou 22h, ou le jour même à
  5h, 6h, 7h, 8h ou 12h.

Ajoutez ensuite l'action **Envoyer un message**. Le texte peut utiliser les
variables du déclencheur :

- **Déchets collectés** : « Ordures ménagères et Emballages (bac jaune) » ;
- **Date de la collecte** : « mardi 6 octobre 2026 » ;
- **Jours avant la collecte** : 1 la veille, 0 le jour même.

Exemple : « 🗑️ Demain, sortez : _Déchets collectés_ ».

Le rappel tient compte des jours fériés et des exceptions : si la collecte
du mardi passe au mercredi, le rappel « la veille à 19h » arrive le mardi
soir. Si Gladys ou l'intégration était arrêtée au moment prévu, un rappel en
retard de moins de 30 minutes est encore envoyé ; au-delà, il est abandonné.

**Sans le déclencheur**, avec les capteurs : déclencheur **Horaire** tous les
jours à 19:00, puis **Continuer seulement si** le capteur « Jours avant la
collecte » de l'appareil voulu **est égal à 1**, puis **Envoyer un message**.

## Widget

Ajoutez le widget **Collectes des déchets** à un tableau de bord : il liste
les prochaines collectes avec un badge « Aujourd'hui » / « Demain ». Ses
réglages : le nombre de lignes (1 à 8) et les types de déchets à afficher
(vide = tous).

## Dépannage

- **« Adresse introuvable »** : écrivez l'adresse complète avec le code
  postal et la commune, ou renseignez le code INSEE.
- **« Aucune collecte trouvée »** : l'adresse est reconnue mais le
  fournisseur choisi ne la dessert pas ; vérifiez le fournisseur.
- **« Mot non compris »** : un mot de votre règle n'est pas reconnu ; le
  bouton « Tester une règle » permet d'ajuster la phrase.
- Les logs de l'intégration (`LOG_LEVEL=debug` pour le détail) sont
  visibles depuis l'interface Gladys.
