# Top14Forecast

Top14Forecast est une application web de simulation de fin de saison du Top 14. Elle combine classement courant, calendrier restant, pronostics utilisateur et simulation Monte Carlo pour estimer les probabilités d'accès au top 2, au top 6 et, plus largement, aux différentes zones du classement final.

Application en ligne : <https://baronzep.github.io/Top14Forecast/>

## Objectif

L'outil permet de répondre rapidement à deux types de questions :
- quelle est la probabilité qu'une équipe atteigne un objectif donné ;
- quel est l'impact d'un ou plusieurs résultats précis sur la fin de saison.

Il peut être utilisé à la fois comme tableau de bord de consultation et comme simulateur de scénarios.

## Fonctionnement

L'application repose sur quatre éléments :
- un classement initial cohérent avec l'état réel de la saison ;
- le calendrier restant ;
- un système de pronostics utilisateur ;
- un moteur de simulation Monte Carlo.[1]

Des ajustements de points peuvent être appliqués pour refléter d'éventuelles décisions réglementaires et conserver la cohérence du classement de référence.

## Modes d'utilisation

### Consultation

L'utilisateur ouvre l'application pour visualiser le classement, les rencontres restantes et les probabilités associées à l'état actuel du championnat.

### Simulation libre

Aucun résultat n'est imposé sur les matches restants. Le moteur simule alors un grand nombre de fins de saison possibles afin de produire une projection globale.

### Scénario partiel

L'utilisateur fixe seulement certains résultats jugés décisifs, puis laisse le reste être simulé. Ce mode est adapté à l'analyse de confrontations directes ou de cas ciblés.

### Scénario complet

L'ensemble des résultats restants peut être imposé pour construire une fin de saison entièrement déterministe et en observer les conséquences sur le classement final.

### Partage par clé

Les pronostics peuvent être encodés dans une clé compacte en hexadécimal. Cette clé permet de sauvegarder, recharger et partager rapidement un scénario.

## Clé de pronostic

Le projet utilise un encodage compact des pronostics, fondé sur 3 bits par équipe et par journée selon la logique définie dans l'application.

La validation est volontairement souple : la longueur de la clé ne doit pas dépasser le nombre de matches restants à représenter, sans exigence de longueur minimale, ce qui autorise les scénarios partiels.

Cette clé permet de sauvegarder, recharger et partager rapidement un scénario.

## Interface

L'application distingue la mise à jour de l'affichage et le recalcul complet des probabilités. Le classement et les points affichés peuvent être réordonnés à partir de résultats saisis, tandis que la simulation complète n'est relancée qu'à la demande explicite de l'utilisateur.

Ce choix permet de conserver une interface fluide, y compris lors de l'exploration de plusieurs hypothèses successives.

Des ajustements d'ergonomie ont également été apportés au champ de saisie de la clé de pronostic, ainsi qu'à certains comportements de copie sur mobile.

## Utilisation

1. Ouvrir l'application.
2. Observer le classement et les matches restants.
3. Choisir entre consultation simple, simulation libre, scénario partiel ou scénario complet.
4. Lancer la simulation pour mettre à jour les probabilités.
5. Copier la clé de pronostic pour conserver ou partager le scénario.

## Hypothèses du modèle

Le moteur Monte Carlo repose sur une hypothèse volontaire de simplicité : les issues possibles d'un match simulé sont tirées de manière équiprobable dans l'espace des résultats retenus par le modèle, sans pondération supplémentaire liée à la force supposée des équipes, à la forme du moment ou à l'avantage du terrain.[2][3]

Ce choix est assumé. L'objectif de l'outil n'est pas de produire un modèle prédictif sophistiqué match par match, mais d'explorer proprement les conséquences de la structure du calendrier, du classement courant et des confrontations directes sur les positions finales possibles.[2]

Cette approche présente deux avantages : elle reste lisible, rapide à exécuter dans le navigateur et facile à interpréter, tout en évitant d'introduire des hypothèses de puissance d'équipe difficiles à calibrer et potentiellement plus discutables que le modèle lui-même.[2]

Les résultats doivent donc être lus comme des estimations structurelles conditionnelles au classement et au calendrier, et non comme des prédictions sportives fines de chaque rencontre. Leur qualité dépend aussi de la cohérence entre classement initial, calendrier, résultats connus et éventuels ajustements de points.

---

> Je ne vous garantis pas le succès, mais je vous garantis que l'échec n'est pas encore écrit.
