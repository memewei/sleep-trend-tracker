# sleep-trend-tracker

Log your sleep each day, see the month on a notebook-style chart, and compare trends between months.

## Run it

```sh
npm start
```

Then open <http://localhost:4173>. Node is all you need, and there are no packages to install. Keep the command running while you use the app.

## Use it

**Month view**

- Log each night under the date you woke up. Each row has a noon-to-noon bar for the two times, plus a box for quality (1–100).
- On an empty row, drag across the bar to draw the night, or click once for sleep start and again for wake. On a filled row, drag the filled dot (sleep start) or the hollow dot (wake). Dragging moves in 15-minute steps and saves when you let go. Use × to clear a row's times.
- For finer control, click or tab to a dot and use the arrow keys for 5 minutes, or Shift+arrow or Page Up/Down for 30 minutes. Delete clears that time, and Esc cancels a drag.
- Sleep hours fill in from the two times, including across midnight. Type over them (`7.5` or `7:30`) if you slept less than that, or clear the box to go back to the calculated value.
- The chart shows quality scores along the top, sleep hours in the middle with red lines at 7 and 9 hours, and sugar, alcohol, stretching and coffee marks underneath.
- Click a habit cell to toggle its X, or anywhere else on a day to jump to its row in the log.

**Naps**

- Turn on **Include naps** at the top of the page to get a nap bar under each day. It works like the sleep bar, and you log the nap on the date it happened.
- While it's on, nap time is added to that date's sleep hours on every chart and average, including nights in the 7–9 hour range. The Hours box still shows the night alone, and sleep quality is unchanged.
- Turning it off stops counting naps and hides the bars, but keeps the saved times. A nap on a date with no logged night isn't added to any chart or average.

**Compare months**

- Tick up to 6 months and choose sleep hours, quality, sleep start time or wake time. Each month becomes one line, plotted by day of the month.
- The table underneath compares averages, nights in the 7–9 hour range and habit counts.

**Insights**

- **Sleep hours vs quality** and **sleep start vs quality** show one dot per night with a trend line.
- **7-day trends** track average hours, average quality and how much your sleep start time varies. Each point needs at least 4 logged nights in its 7 days.
- These show what tends to happen together, not what causes what.

## Your data

Every change saves straight away to `sleep-data.csv` in this folder, and the file loads each time you open the app. The header shows the save status. If a save fails, the app keeps your changes and retries while the page stays open.

The file has one row per day, sorted by date:

```csv
date,sleep_start,wake_time,sleep_hours,sleep_quality,sugar,alcohol,stretching,coffee,nap_start,nap_wake
2026-11-03,23:30,07:15,7.75,84,1,0,0,1,13:00,14:00
```

Habit columns use `1` for yes and `0` for no. Leave any other field blank if you don't have a value. If `sleep_hours` is blank, it's calculated from the two times. Older files without the nap columns still load, and the next save adds them.

`sleep-data.csv` is personal, so it's in `.gitignore` and isn't backed up by committing. Copy it somewhere safe now and then.

### Editing the CSV by hand

You can edit the file in a text editor or spreadsheet. Reload the app afterwards to see your changes.

- Dates must stay in `YYYY-MM-DD` format. Excel may change them when it saves, so check that first.
- Don't add or rename columns.
- If the app can't read a row, it tells you which line to fix and won't change the file until you've fixed it.

### Earlier browser data

If you logged nights before CSV saving existed, opening the app at the same address (<http://localhost:4173>) moves them into the CSV, as long as the CSV is still empty. Entries made in a directly opened `index.html` can't be moved automatically. Open that file again and use **Export**, then use **Import** at <http://localhost:4173>.

**Export** and **Import** handle JSON copies of your data. Importing merges by date, and imported days replace existing ones after you confirm.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4173` | Port for the app |
| `SLEEP_CSV` | `sleep-data.csv` in this folder | Where the data file lives |

The browser treats each port as a separate address, which only matters for moving earlier browser data.

## Develop

```sh
npm test
```

| File | Purpose |
| --- | --- |
| `js/core.js` | Date, time and summary logic, with no DOM (covered by `test/core.test.js`) |
| `js/charts.js` | SVG month and comparison charts |
| `js/time-track.js` | Draggable sleep time bar |
| `js/app.js` | Page state, saving and the entry table |
| `server/index.js` | Local server that serves the app and handles saves (covered by `test/server.test.js`) |
| `server/csv.js` | Reads and writes the CSV |
