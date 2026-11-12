# Renault Logan · OBD-II Scanner

Веб-приложение для диагностики Renault Logan через ELM327 BLE
и ведения журнала технического обслуживания.

## Возможности

- 🔌 Подключение к ELM327 по Web Bluetooth (BLE 4.0)
- 📊 Живые параметры: обороты, скорость, температура ОЖ, напряжение и др.
- 📈 Графики в реальном времени + пресеты (АКБ / прогрев / разгон)
- ⚠️ Алерты: перегрев ОЖ, низкое напряжение АКБ (звук + цвет)
- 🩺 Чтение и стирание кодов ошибок (DTC)
- 📋 Журнал ТО: 44 позиции, 5 двигателей Logan, напоминания
- 🚗 Мульти-профили по VIN / госномеру (несколько машин в семье)
- 💾 Экспорт / импорт JSON, авторезерв в localStorage

## Требования

- Браузер: **Chrome или Edge** (Web Bluetooth)
- ОС: Windows, macOS, Linux, **Android** (iOS не поддерживает Web Bluetooth)
- Адаптер: **ELM327 BLE 4.0** (не классический Bluetooth!)
  - Vgate iCar Pro BLE 4.0
  - Viecar BLE 4.0
  - Vgate vLinker BM+ BLE
  - OBDLink MX+

## Запуск

Приложение работает по HTTPS (требование Web Bluetooth):

👉 **https://ВАШ_ЛОГИН.github.io/renault-obd/**

Локально:
```bash
python -m http.server 8000
# открыть http://localhost:8000