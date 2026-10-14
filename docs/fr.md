# DSMR Smart Meter

Cette intégration lit votre **compteur communicant DSMR via son port P1** :
l'électricité consommée et injectée sur le réseau, les mesures de chaque phase,
ainsi que les **compteurs de gaz et d'eau** reliés au compteur électrique.
Tout reste sur votre réseau local : pas de cloud, pas de compte.

## Mon compteur est-il compatible ?

| Pays       | Compteurs compatibles                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Pays-Bas   | Tous les compteurs communicants (DSMR 2.2 à 5.0.2)                                                                                |
| Belgique   | Compteurs numériques (Fluvius, Sibelga, ORES, RESA) — **activez le port P1** dans l'espace client de votre gestionnaire de réseau |
| Luxembourg | Compteurs Smarty — demandez à **Creos** la **clé de déchiffrement** de votre compteur                                             |
| Suède      | Compteurs avec **port HAN** (format P1) — demandez son activation à votre gestionnaire de réseau                                  |
| Hongrie    | Compteurs communicants E.ON et MVM dotés d'un port P1                                                                             |

Non compatibles : le Linky français (utilisez une intégration de
téléinformation), ainsi que les compteurs allemands, espagnols, autrichiens,
suisses, norvégiens et danois, qui utilisent d'autres protocoles.

## Ce qu'il vous faut

Un **lecteur P1** connecté à votre réseau, branché sur le port P1 (prise RJ12)
du compteur :

- un **dongle P1** Wi-Fi/Ethernet qui diffuse les télégrammes bruts sur un port
  TCP (cherchez un mode « TCP », « socket », « telnet » ou « raw telegram »
  dans sa notice), ou une passerelle P1 ESPHome/Tasmota qui fait de même ;
- un **HomeWizard Wi-Fi P1 meter** : activez l'**API locale** dans
  l'application HomeWizard (Paramètres → Compteurs → votre compteur → API
  locale) ;
- un **câble USB P1** branché sur n'importe quel ordinateur du réseau (celui
  qui fait tourner Gladys convient aussi), partagé sur le réseau avec
  **ser2net** — voir le
  [README](https://github.com/gboulvin/Gladys-DSMR-Smart-Meter#compatible-p1-readers)
  pour une configuration prête à l'emploi.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Choisissez le **type de connexion** :
   - **Flux TCP** : saisissez l'**adresse IP** du lecteur et son **port** (23
     sur la plupart des dongles, le port choisi pour ser2net) ;
   - **HTTP** : saisissez l'**URL du télégramme**, par exemple
     `http://192.168.1.50/api/v1/telegram` pour un HomeWizard.
3. **Luxembourg uniquement** : saisissez la **clé de déchiffrement** de 32
   caractères fournie par Creos. Laissez le champ vide dans les autres pays.
4. L'**intervalle de rafraîchissement** (10 s par défaut) règle la fréquence
   d'envoi des mesures à Gladys. Les déclencheurs de scène réagissent à chaque
   télégramme, quel que soit cet intervalle.
5. Enregistrez, puis cliquez sur **Tester la connexion** : l'intégration
   attend le prochain télégramme et affiche le numéro du compteur, la version
   DSMR et les index.
6. Ouvrez l'onglet **Découverte** et ajoutez les appareils : le compteur
   électrique, ainsi que les compteurs de gaz et d'eau s'ils sont relayés.

## Appareils

**Compteur électrique (P1)** — seules les mesures transmises par votre
compteur sont créées :

- puissance consommée et puissance injectée (W), au total et par phase ;
- index de consommation par tarif (kWh) — ou un index total unique (Suède,
  Luxembourg). Ces index alimentent le **suivi énergétique** de Gladys :
  consommation par demi-heure, par jour, et coûts selon votre contrat ;
- index d'injection (kWh), pour les logements équipés de panneaux solaires ;
- tension (V) et courant (A) par phase ;
- tarif en cours (1 ou 2). Pays-Bas : 1 = bas (nuit/week-end), 2 = normal.
  Belgique : 1 = jour, 2 = nuit ;
- Belgique : **puissance moyenne quart-horaire** et **pointe du mois**, base
  du tarif capacitaire.

**Compteur de gaz (P1)** et **Compteur d'eau (P1)** — l'index en m³. Un
compteur DSMR 5 met à jour l'index gaz toutes les 5 minutes, les plus anciens
toutes les heures.

## Scènes

Dans la catégorie **Intégrations** de l'éditeur de scènes (Gladys 5.1 ou plus) :

Déclencheurs :

- **Changement de tarif électrique** — par exemple, lancer le lave-vaisselle
  quand le tarif le moins cher commence. Le nouveau tarif est disponible dans
  `{{triggerEvent.data.tariff}}`.
- **Début ou fin d'injection réseau** — votre logement commence à envoyer son
  surplus solaire sur le réseau (ou recommence à consommer). Le changement doit
  durer 30 secondes, pour qu'un nuage de passage ne le déclenche pas. La
  puissance est disponible dans `{{triggerEvent.data.power}}`.
- **Coupure de courant détectée** — le compteur a enregistré une nouvelle
  coupure (le déclencheur part au retour du courant et du lecteur).
- **Nouvelle pointe mensuelle** (Belgique) — vous prévient quand la puissance
  moyenne quart-horaire bat le record du mois, ce qui augmente le tarif
  capacitaire.

Actions :

- **Lire le compteur P1** — transmet aux actions suivantes la puissance
  consommée et injectée, les index, le tarif et les index gaz et eau.
- **Bilan énergétique du jour** — transmet la consommation, l'injection, le
  gaz, l'eau et le pic de puissance du jour, par exemple pour un message le
  soir.

## Tableau de bord

Deux widgets sont disponibles dans l'éditeur de tableau de bord :

- **Compteur P1 : synthèse** : puissance consommée et injectée en direct,
  index gaz, totaux du jour, tarif en cours, état de la connexion et graphique
  de puissance (période au choix).
- **Compteur P1 : phases** : courant de chaque phase sur une jauge à l'échelle
  de votre disjoncteur (à régler dans les paramètres du widget, ex. 25 A ou
  40 A), tensions, creux et pics de tension, coupures.

## Dépannage

- **« Lecteur P1 injoignable »** : vérifiez l'adresse IP et le port, et que le
  lecteur est sur le même réseau que Gladys. La plupart des lecteurs P1
  n'acceptent **qu'une seule connexion** : fermez les autres logiciels qui y
  sont connectés (Home Assistant, Domoticz…), ou activez l'option multi-client
  du lecteur.
- **Aucun télégramme avec un câble USB et ser2net** : vérifiez les paramètres
  série — 115200 8N1 pour DSMR 4/5, 9600 7E1 pour DSMR 2.2/3.0.
- **Belgique : aucune donnée** : le port P1 est désactivé par défaut —
  activez-le dans l'espace client de votre gestionnaire de réseau.
- **Luxembourg : « impossible de déchiffrer »** : la clé de déchiffrement est
  erronée ou incomplète (32 caractères hexadécimaux).
- **Les télégrammes corrompus** sont écartés grâce à leur CRC : si cela arrive
  souvent, vérifiez le câble et le signal Wi-Fi du lecteur.

L'intégration journalise tout ce qu'elle fait : consultez ses logs dans
l'interface de Gladys.
