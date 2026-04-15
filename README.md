# Poker Planning

Planning Poker приложение (React + TypeScript backend + Redis), завернутое в Docker Compose.

## Запуск (dev)

```bash
docker compose --profile dev up --build
```

- Frontend: `http://localhost/` (порт **80**)
- Backend: `http://localhost:3000/health`

Запросы с браузера идут на тот же хост, что и страница; Vite проксирует `/rooms`, `/health` и `/socket.io` в сервис `backend` (`VITE_PROXY_TARGET`). Так работает вход по IP/домену, а не только через `localhost:3000`.

### Smoke test (dev)

- **Создать комнату**: на главной нажать “Создать комнату”, при необходимости включить/выключить “Использовать роли”.
- **Войти в комнату**: открыть 2 вкладки, ввести один и тот же код, разные имена.
  - если роли включены — выбрать разные роли (например, 2×`BE` и 2×`QA`)
- **Проголосовать**: выбрать карточки; до Reveal у всех должны быть только статусы (✓/…).
- **Reveal**: ведущий нажимает Reveal — оценки показываются всем.
  - если роли включены: в “Агрегаты” должны появиться отдельные группы по ролям (например `BE` и `QA`) и средние/медианы по каждой
  - если роли выключены: должен быть один общий агрегат “Все”
- **New round**: ведущий нажимает New round — очищаются голоса, скрытие включается снова.

## Запуск (prod)

```bash
docker compose --profile prod up --build
```

- Frontend: `http://localhost/` (порт **80**; nginx отдаёт UI и проксирует API/WebSocket)
- Backend: `http://localhost:3000/health`

