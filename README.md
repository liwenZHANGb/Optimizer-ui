# LW Optimizer UI

The web interface of [LW Optimizer](../lw-optimizer). It launches the use cases, lets you tune
the solver and the constraints, shows the optimization while it runs, and lets you adjust a
plan by hand and optimize it again.

It is a front end only. There is no optimization code in this repository: every action goes
through the REST API of `lw-optimizer` (module `optimizer-api`), which runs separately and
works just as well without this interface.

```
  browser                        this repository                 lw-optimizer
+-----------+   pages, scripts   +----------------+
|           | <----------------- | lw-optimizer-ui|  :8081   static files only
|   pages   |                    +----------------+
|           |   REST + events    +----------------+
|           | <----------------> | optimizer-api  |  :8080   models, constraints, solvers
+-----------+                    +----------------+
```

## Run it

1. Start the API, from the `lw-optimizer` repository:

   ```bash
   ./mvnw install -DskipTests
   ```

   ```bash
   ./mvnw -pl optimizer-api spring-boot:run
   ```

2. Start the interface, from this repository:

   ```bash
   ./mvnw spring-boot:run
   ```

3. Open `http://localhost:8081`.

Only a JDK 21+ is needed; there is no Node.js build. If the API is somewhere else:

```bash
./mvnw spring-boot:run -Dspring-boot.run.arguments=--lw.api-url=http://my-server:8080
```

and add the address of the interface to `lw.api.cors.allowed-origins` on the API side.

## What it does

| | |
|---|---|
| **Launch a use case** | Task assignment, vehicle routing, stock management, carpooling: one entry each in the left rail. |
| **Tune the solver** | The *Solver* tab: engine (genetic algorithm, OR-Tools, Choco where a formulation exists), time limit, stall limit, seed, warm start, and the parameters of the genetic algorithm. Every field starts at its default; *Restore defaults* brings them back. For routing, also where travel times come from: straight line, road network (OpenStreetMap through OSRM) or random bounds. |
| **Tune the constraints** | The *Constraints* tab: switch each one on or off, choose its nature (hard, medium, soft) and its weight. The score of the plan on screen is updated at once. |
| **Watch the search** | *Solve* streams every improvement from the API. Items glide to their new place, what moved is listed under *What just changed*, and the score is broken down per constraint under *Where the score comes from*. |
| **Replay it** | The bar at the bottom holds every improvement of the run: scrub through it, pause, replay, change speed. The curve is the cost over the improvements. |
| **Reschedule** | Tasks and routing. After a run (or before), drag a task to another employee or a stop to another route or position; click a task or a stop to pin it; *Pin all* or *Pin route* freeze a whole lane. *Solve* then optimizes from the edited plan and leaves what is pinned alone. |
| **Add a customer by address** | Routing: type an address under *Not visited*; it is geocoded with OpenStreetMap (Nominatim) and added to the plan. |

Each use case has its own screen:

- **Task assignment**: one lane per employee, one block per task as wide as it is long, the
  capacity as a dashed line.
- **Vehicle routing**: the routes on an OpenStreetMap map, and each route as an ordered list
  of stops with its load, distance and driving time.
- **Stock management**: per product, the stock at the end of each period, the orders placed
  and the safety stock; below, how full the warehouse is.
- **Carpooling**: the trips on a map, and one timeline per driver with each pickup at the
  minute it happens and the deadline.

## How it is built

Plain HTML, CSS and JavaScript modules in `src/main/resources/static`, served by a few lines
of Spring Boot. No framework and no build step: edit a file and reload the page.

```
static/
  index.html          the shell: rail, plan area, playback bar, side panel
  css/app.css         the whole look: tokens, layout, components, one section per use case
  js/app.js           controller: API calls, job events, playback, tabs
  js/settings.js      solver and constraint forms, generated from GET /configuration
  js/score.js         score, score analysis, cost curve
  js/util.js          DOM helpers, move animation (FLIP), drag and drop
  js/views/           one module per use case: tasks, vrp, stock, carpool (+ the shared map)
```

The interface knows nothing about a use case beyond its view module. Settings, their bounds
and defaults, and the constraints all come from the API, so a setting added there appears
here without a change.

To add a use case: implement it in the API, add an entry to `USE_CASES` in `js/app.js`, and
write a view module exporting `mount(root, ctx)`, which returns `{ update(plan, options) }`,
and `diff(previous, next)`, which lists what changed in words.

The map tiles come from `tile.openstreetmap.org`; without a network the markers and routes
still show on a blank background. Leaflet itself is served locally.

## Settings

`src/main/resources/application.yaml`:

| Setting | Default | Meaning |
|---|---|---|
| `server.port` | `8081` | Port of the interface. |
| `lw.api-url` | `http://localhost:8080` | Address of the LW Optimizer API, as seen from the user's browser. |
