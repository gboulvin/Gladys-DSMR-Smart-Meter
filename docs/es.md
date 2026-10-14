# DSMR Smart Meter

Esta integración lee su **contador inteligente DSMR a través de su puerto P1**:
la electricidad que consume e inyecta en la red, las mediciones de cada fase y
los **contadores de gas y agua** conectados al contador eléctrico. Todo se
queda en su red local: sin nube, sin cuenta.

## ¿Es compatible mi contador?

| País         | Contadores compatibles                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| Países Bajos | Todos los contadores inteligentes (DSMR 2.2 a 5.0.2)                                                           |
| Bélgica      | Contadores digitales (Fluvius, Sibelga, ORES, RESA) — **active el puerto P1** en el portal de su gestor de red |
| Luxemburgo   | Contadores Smarty — solicite a **Creos** la **clave de descifrado** de su contador                             |
| Suecia       | Contadores con **puerto HAN** (formato P1) — solicite su activación a su gestor de red                         |
| Hungría      | Contadores inteligentes de E.ON y MVM con puerto P1                                                            |

No compatibles: el Linky francés (use una integración de teleinformación) y los
contadores alemanes, españoles, austriacos, suizos, noruegos y daneses, que
usan otros protocolos. En España, los contadores de las distribuidoras no
tienen puerto P1.

## Qué necesita

Un **lector P1** conectado a su red y enchufado al puerto P1 (toma RJ12) del
contador:

- un **dongle P1** Wi-Fi/Ethernet que emita los telegramas en bruto por un
  puerto TCP (busque un modo «TCP», «socket», «telnet» o «raw telegram» en su
  manual), o un puente P1 ESPHome/Tasmota que haga lo mismo;
- un **HomeWizard Wi-Fi P1 meter**: active la **API local** en la aplicación
  HomeWizard (Ajustes → Contadores → su contador → API local);
- un **cable USB P1** conectado a cualquier ordenador de la red (también sirve
  el que ejecuta Gladys), compartido en la red con **ser2net** — consulte el
  [README](https://github.com/gboulvin/Gladys-DSMR-Smart-Meter#compatible-p1-readers)
  para una configuración lista para usar.

## Configuración

1. Abra la pestaña **Configuración** de la integración.
2. Elija el **tipo de conexión**:
   - **Flujo TCP**: introduzca la **dirección IP** del lector y su **puerto**
     (23 en la mayoría de los dongles, el puerto elegido para ser2net);
   - **HTTP**: introduzca la **URL del telegrama**, por ejemplo
     `http://192.168.1.50/api/v1/telegram` para un HomeWizard.
3. **Solo Luxemburgo**: introduzca la **clave de descifrado** de 32 caracteres
   facilitada por Creos. Deje el campo vacío en los demás países.
4. El **intervalo de actualización** (10 s por defecto) fija la frecuencia de
   envío de las mediciones a Gladys. Los disparadores de escena reaccionan a
   cada telegrama, sea cual sea este intervalo.
5. Guarde y haga clic en **Probar la conexión**: la integración espera el
   siguiente telegrama y muestra el número del contador, la versión DSMR y los
   índices.
6. Abra la pestaña **Descubrimiento** y añada los dispositivos: el contador
   eléctrico y, si su contador los retransmite, los contadores de gas y agua.

## Dispositivos

**Contador eléctrico (P1)** — solo se crean las mediciones que transmite su
contador:

- potencia consumida y potencia inyectada (W), en total y por fase;
- índice de consumo por tarifa (kWh) — o un único índice total (Suecia,
  Luxemburgo). Estos índices alimentan el **seguimiento energético** de
  Gladys: consumo por media hora, por día y costes según su contrato;
- índices de inyección (kWh), para viviendas con paneles solares;
- tensión (V) y corriente (A) por fase;
- tarifa actual (1 o 2). Países Bajos: 1 = baja (noche/fin de semana), 2 =
  normal. Bélgica: 1 = día, 2 = noche;
- Bélgica: **demanda media cuartohoraria** y **pico del mes**, la base de la
  tarifa de capacidad.

**Contador de gas (P1)** y **Contador de agua (P1)** — el índice en m³. Un
contador DSMR 5 actualiza el índice de gas cada 5 minutos; los más antiguos,
cada hora.

## Escenas

En la categoría **Integraciones** del editor de escenas (Gladys 5.1 o
posterior):

Disparadores:

- **Cambio de tarifa eléctrica** — por ejemplo, poner el lavavajillas cuando
  empieza la tarifa más barata. La nueva tarifa está disponible en
  `{{triggerEvent.data.tariff}}`.
- **Inicio o fin de inyección a la red** — su vivienda empieza a enviar su
  excedente solar a la red (o vuelve a consumir de ella). El cambio debe durar
  30 segundos, para que una nube pasajera no lo dispare. La potencia está
  disponible en `{{triggerEvent.data.power}}`.
- **Corte de luz detectado** — el contador ha registrado un nuevo corte (el
  disparador se activa al volver la luz y el lector).
- **Nuevo pico mensual de demanda** (Bélgica) — le avisa cuando la demanda
  media cuartohoraria supera el récord del mes, lo que encarece la tarifa de
  capacidad.

Acciones:

- **Leer el contador P1** — pasa a las acciones siguientes la potencia
  consumida e inyectada, los índices, la tarifa y los índices de gas y agua.
- **Balance energético de hoy** — pasa el consumo, la inyección, el gas, el
  agua y el pico de potencia de hoy, por ejemplo para un mensaje por la noche.

## Panel de control

Hay dos widgets disponibles en el editor del panel:

- **Contador P1: resumen**: potencia consumida e inyectada en directo, índice
  de gas, totales del día, tarifa actual, estado de la conexión y un gráfico
  de potencia (periodo a elegir).
- **Contador P1: fases**: corriente de cada fase en un indicador a la escala de
  su fusible (configúrelo en los ajustes del widget, p. ej. 25 A o 40 A),
  tensiones, huecos y picos de tensión, cortes.

## Solución de problemas

- **«Lector P1 inaccesible»**: compruebe la dirección IP y el puerto, y que el
  lector esté en la misma red que Gladys. La mayoría de los lectores P1 solo
  aceptan **una conexión**: cierre los demás programas conectados (Home
  Assistant, Domoticz…) o use la opción multicliente del lector.
- **Ningún telegrama con cable USB y ser2net**: compruebe los parámetros serie
  — 115200 8N1 para DSMR 4/5, 9600 7E1 para DSMR 2.2/3.0.
- **Bélgica: ningún dato**: el puerto P1 está desactivado por defecto —
  actívelo en el portal de clientes de su gestor de red.
- **Luxemburgo: «no se pueden descifrar»**: la clave de descifrado es
  incorrecta o incompleta (32 caracteres hexadecimales).
- **Los telegramas dañados** se descartan gracias a su CRC: si ocurre a
  menudo, compruebe el cable y la señal Wi-Fi del lector.

La integración registra todo lo que hace: consulte sus registros en la
interfaz de Gladys.
