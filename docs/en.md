# DSMR Smart Meter

This integration reads your **DSMR smart meter through its P1 port**: the
electricity you consume and inject into the grid, the measurements of each
phase, and the **gas and water meters** connected to the electricity meter.
Everything stays on your local network: no cloud, no account.

## Is my meter compatible?

| Country     | Compatible meters                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Netherlands | Every smart meter (DSMR 2.2 to 5.0.2)                                                                            |
| Belgium     | Digital meters (Fluvius, Sibelga, ORES, RESA) — **activate the P1 port** in your grid operator's customer portal |
| Luxembourg  | Smarty meters — ask **Creos** for the **decryption key** of your meter                                           |
| Sweden      | Meters with a **HAN port** (P1 format) — ask your grid operator to activate it                                   |
| Hungary     | E.ON and MVM smart meters with a P1 port                                                                         |

Not compatible: the French Linky (use a teleinformation integration), and the
German, Spanish, Austrian, Swiss, Norwegian and Danish meters, which speak
other protocols.

## What you need

A **P1 reader** connected to your network, plugged into the P1 port (RJ12
socket) of the meter:

- a Wi-Fi/Ethernet **P1 dongle** that streams the raw telegrams on a TCP port
  (look for a "TCP", "socket", "telnet" or "raw telegram" mode in its manual),
  or an ESPHome/Tasmota P1 bridge doing the same;
- a **HomeWizard Wi-Fi P1 meter**: enable the **local API** in the HomeWizard
  app (Settings → Meters → your meter → Local API);
- a **USB P1 cable** plugged into any computer of the network (the one running
  Gladys works too), shared on the network with **ser2net** — see the
  [README](https://github.com/gboulvin/Gladys-DSMR-Smart-Meter#compatible-p1-readers)
  for a ready-to-use configuration.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Pick the **connection type**:
   - **TCP stream**: enter the **IP address** of the reader and its **port**
     (23 on most dongles, the port you chose for ser2net);
   - **HTTP**: enter the **telegram URL**, e.g.
     `http://192.168.1.50/api/v1/telegram` for a HomeWizard.
3. **Luxembourg only**: enter the 32-character **decryption key** given by
   Creos. Leave the field empty in every other country.
4. The **refresh interval** (10 s by default) sets how often the readings are
   sent to Gladys. Scene triggers react to every telegram, whatever it is.
5. Save, then click **Test the connection**: the integration waits for the
   next telegram and shows the meter number, the DSMR version and the indexes.
6. Open the **Discovery** tab and add the devices: the electricity meter, plus
   the gas and water meters when your meter relays them.

## Devices

**Electricity meter (P1)** — only the features your meter reports are created:

- power consumed and power injected (W), in total and per phase;
- consumption index per tariff (kWh) — or a single total index (Sweden,
  Luxembourg). These indexes feed the **energy monitoring** of Gladys:
  consumption per half hour, per day, and costs with your contract;
- injection indexes (kWh), for homes with solar panels;
- voltage (V) and current (A) per phase;
- current tariff (1 or 2). Netherlands: 1 = low (night/weekend), 2 = normal.
  Belgium: 1 = day, 2 = night;
- Belgium: 15-minute **average demand** and **peak demand of the month**, the
  basis of the capacity tariff.

**Gas meter (P1)** and **Water meter (P1)** — the index in m³. A DSMR 5 meter
updates the gas index every 5 minutes, older meters every hour.

## Scenes

Under the **Integrations** category of the scene editor (Gladys 5.1 or later):

Triggers:

- **Electricity tariff changed** — e.g. start the dishwasher when the cheaper
  tariff begins. The new tariff is available as `{{triggerEvent.data.tariff}}`.
- **Grid injection started or stopped** — your home starts sending its solar
  surplus to the grid (or consumes from it again). The change must last 30
  seconds, so a passing cloud does not trigger it. The power is available as
  `{{triggerEvent.data.power}}`.
- **Power failure detected** — the meter counted a new power failure (the
  trigger fires when power and the reader are back).
- **New monthly peak demand** (Belgium) — warns you when the 15-minute
  average demand beats the month's record, which raises the capacity tariff.

Actions:

- **Read the P1 meter** — gives the following actions the power consumed and
  injected, the indexes, the tariff and the gas and water indexes.
- **Today's energy summary** — gives today's consumption, injection, gas,
  water and peak power, e.g. for an evening message.

## Dashboard

Two widgets are available in the dashboard editor:

- **P1 meter overview**: live power consumed and injected, gas index, today's
  totals, current tariff, connection state and a power chart (period of your
  choice).
- **P1 meter phases**: current of each phase on a gauge scaled to your fuse
  rating (set it in the widget settings, e.g. 25 A or 40 A), voltages,
  voltage sags and swells, power failures.

## Troubleshooting

- **"P1 reader unreachable"**: check the IP address and port, and that the
  reader is on the same network as Gladys. Most P1 readers accept **a single
  connection**: close any other software connected to it (Home Assistant,
  Domoticz…), or use the reader's multi-client option.
- **No telegram on a USB cable with ser2net**: check the serial settings —
  115200 8N1 for DSMR 4/5, 9600 7E1 for DSMR 2.2/3.0.
- **Belgium: no data at all**: the P1 port is disabled by default — activate
  it in your grid operator's customer portal.
- **Luxembourg: "cannot be decrypted"**: the decryption key is wrong or
  incomplete (32 hexadecimal characters).
- **Corrupted telegrams** are dropped thanks to their CRC: if it happens often,
  check the cable and the Wi-Fi signal of the reader.

The integration logs everything it does: check its logs in the Gladys
interface.
