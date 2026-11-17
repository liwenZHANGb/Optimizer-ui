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
| **Choose a language** | English, French or Chinese (Simplified), from the selector at the foot of the left rail. The whole page is reworded in place, a run in progress included; the choice is remembered. Without a choice, the language of the browser applies. |
| **Choose a theme** | Light or dark, from the button under the language selector. Without a choice, the theme of the system applies. |
| **Launch a use case** | Task assignment, vehicle routing, stock management, carpooling, job shop scheduling, academic timetabling, stock sizing, BL.Optim TASP and VRP: one entry each in the left rail. |
| **Import your data** | *Import data* opens a dialog that lists the tables and columns the use case reads, offers an example workbook (.xlsx) and example CSV files, and takes your files by selection or by drop. The data replaces the plan on screen; an error names the table, the row and the column. |
| **Tune the solver** | The *Solver* tab: engine (genetic algorithm, DR-ALNS, OR-Tools or Choco, for every use case; for DR-ALNS, its learning (DL) phase on or off, its duration and episodes), time limit, stall limit, seed, warm start, and the parameters of the genetic algorithm. Every field starts at its default; *Restore defaults* brings them back. For routing, also where travel times come from: straight line, road network (OpenStreetMap through OSRM) or random bounds. |
| **Tune the constraints** | The *Constraints* tab, in two groups: *Rules*, which a plan must follow (hard), and *Objectives*, which it is scored on (medium, soft). Switch each one on or off, choose its nature and its weight; the score of the plan on screen is updated at once. A badge tells the constraints that come with the use case (*Standard*) from those added by a user (*Custom*). |
| **Add a rule** | *+ New rule* opens the rule builder. Describe the rule in a sentence and press *Interpret*, or build it: what it applies to, the conditions that must hold and the exceptions as blocks combined with AND, OR and NOT, the nature, the weight, the penalty. The *Building blocks* on the right list everything a rule may read; click one to insert it, or drag it into a field. The structured form and its validation are shown as you type; *Test on the current plan* says who breaks the rule and runs a short optimization without and with it; *Activate rule* is available once the test has passed, after ticking a box if there are warnings. The rule then appears among the constraints, with how it behaved in the jobs that applied it, and can be removed there. |
| **Watch the search** | *Solve* streams every improvement from the API. Items glide to their new place, what moved is listed under *What just changed*, and the score is broken down per constraint under *Where the score comes from*. |
| **Replay it** | The bar at the bottom holds every improvement of the run: scrub through it, pause, replay, change speed. The curve is the cost over the improvements. |
| **Reschedule** | Tasks and routing. After a run (or before), drag a task to another employee or a stop to another route or position; click a task or a stop to pin it; *Pin all* or *Pin route* freeze a whole lane. *Solve* then optimizes from the edited plan and leaves what is pinned alone. An edit shows at once and is scored by the API right after; one the API refuses is undone. *Reset plan* brings the ready-made problem back and keeps the settings and constraints of the panel. |
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
- **Job shop scheduling**: a Gantt chart, by machine or by job, one bar per operation in the
  colour of its job, with the due time of each job and the end of the last operation.
- **Academic timetabling**: the week as a grid, by room, by teacher or by group; lessons in
  the colour of their subject, clashes outlined, the slots a teacher cannot take hatched.
- **BL.Optim TASP**: the week as a Gantt chart, one row per technician and one column per day
  (office hours), activities in the colour of their nature, absences hatched; before solving,
  the activities wait below the chart.
- **BL.Optim VRP**: each technician's day as a route on the map, from their departure place and
  back; beside it, the days with each technician's visits and times, work, travel and distance.
  A day can be singled out.
- **Stock sizing (SIAAP)**: the cost against its theoretical minimum, the six rules with how
  often they are broken, the list of article-store series (searchable, filtered on broken
  rules or unsolvable series) and, for the selected one, its periods: the band between stock
  min and stock max, the stock at the start and end, the demand and the orders. Its import
  takes the MDS and Stock files of a SIAAP export, with the store, year, length of a period
  and number of series to keep.

## How it is built

Plain HTML, CSS and JavaScript modules in `src/main/resources/static`, served by a few lines
of Spring Boot. No framework and no build step: edit a file and reload the page.

```
static/
  index.html          the shell: rail, plan area, playback bar, side panel
  css/app.css         the whole look: theme tokens (dark and light), layout, components, one section per use case
  js/boot.js          sets the theme and the language before the page is drawn
  js/i18n.js          the three languages: lookup, plurals, wording of the API's messages
  js/lang/            en.js (the reference), fr.js, zh.js
  js/app.js           controller: API calls, job events, playback, tabs, language and theme
  js/settings.js      solver and constraint forms, generated from GET /configuration
  js/rules.js         the rule builder: sentence, blocks, preview, checks, activation
  js/import.js        the import dialog: required tables, example files, upload
  js/score.js         score, score analysis, cost curve
  js/util.js          DOM helpers, move animation (FLIP), drag and drop
  js/views/           one module per use case: tasks, vrp, stock, carpool, jobshop, timetable (+ the shared map)
```

The rule builder decides nothing either: it edits the description of a rule and shows what
the API answers. Interpretation, validation, test and activation happen on the server, which
checks everything again when a rule is activated ([RULES.md](../lw-optimizer/docs/RULES.md)).

The interface knows nothing about a use case beyond its view module. Settings, their bounds
and defaults, and the constraints all come from the API, so a setting added there appears
here without a change.

To add a use case: implement it in the API, add an entry to `USE_CASES` in `js/app.js`, and
write a view module exporting `mount(root, ctx)`, which returns `{ update(plan, options) }`,
and `diff(previous, next)`, which lists what changed in words.

The map tiles come from `tile.openstreetmap.org`; without a network the markers and routes
still show on a blank background. Leaflet itself is served locally.

## Languages

Every text of the page is looked up by key in `js/lang/<language>.js`. English is the
reference; a key missing elsewhere falls back to it.

- **Texts of the page** are read with `t('key', {values})`. An entry with `one` and `other`
  is a plural, chosen with its `count`.
- **Texts the API gives in English** are translated by a key derived from their identifier,
  and shown as the API wrote them when a language has no entry: the settings
  (`field.solver.engine`, `field.solver.engine.help`), the groups, the names of the standard
  constraints (`constraint.vehicle-capacity`), the vocabulary of the rules
  (`vocab.vrp.Vehicle.load`), and the messages that come with a code: findings about a rule
  (`finding.*`, `syntax.*`), interpreter notes and problems (`note.*`, `problem.*`), job
  warnings (`warning.*`).
- **Not translated**, on purpose: the rule language (`ENTITY`, `MAX`, `visitCount(v)`), the
  names in the data (employees, towns), scores as the optimizer writes them
  (`0hard/-120soft`), the detail of a refusal by the API, which follows a translated lead-in,
  and the sentences a rule is described with, which the interpreter reads in English.

To add a language: copy `en.js`, translate it, add the texts of the API from `fr.js`,
register the file in `js/i18n.js` (`DICTIONARIES`, `LOCALES`, `LANGUAGES`) and its code in
`js/boot.js`. `LanguagesTest` fails if a language misses a text, or if a script asks for a
text that does not exist.

## Themes

Every colour is a token defined twice at the top of `css/app.css`, for the dark theme and
for the light one; nothing else in the stylesheet names a colour (`LanguagesTest` checks it).
What is drawn outside CSS, the cost curve and the routes on the map, reads the same tokens,
so a new theme is one more block of tokens.

## Settings

`src/main/resources/application.yaml`:

| Setting | Default | Meaning |
|---|---|---|
| `server.port` | `8081` | Port of the interface. |
| `lw.api-url` | `http://localhost:8080` | Address of the LW Optimizer API, as seen from the user's browser. |
