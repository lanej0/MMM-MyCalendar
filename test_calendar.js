const ical = require("node-ical");
const moment = require("moment");

const CALENDAR_URL =
  "https://calendar.google.com/calendar/ical/jonathan.lane%40gmail.com/private-5a36068fa1ed46833193e90050ff447a/basic.ics";
const PAGE_SIZE = 10;

async function testCalendarFetch() {
  try {
    console.log("Fetching calendar data...");
    const events = await ical.async.fromURL(CALENDAR_URL);
    const today = moment().startOf("day");

    // Convert events object to array and sort by start date
    const eventArray = Object.values(events)
      .filter((event) => event.type === "VEVENT")
      .filter((event) => moment(event.start).isSameOrAfter(today)) // Only include events from today
      .map((event) => ({
        title: event.summary,
        start: event.start,
        end: event.end,
        location: event.location,
        description: event.description,
        recurring: !!event.rrule,
      }))
      .sort((a, b) => a.start - b.start);

    console.log(`Total future events found: ${eventArray.length}`);

    // Calculate number of pages
    const totalPages = Math.ceil(eventArray.length / PAGE_SIZE);
    console.log(
      `Events can be split into ${totalPages} pages of ${PAGE_SIZE} events each`
    );

    // Show first page as example
    console.log("\nFirst page of events (from today forward):");
    eventArray.slice(0, PAGE_SIZE).forEach((event, index) => {
      console.log(`\n[Event ${index + 1}]`);
      console.log(`Title: ${event.title}`);
      console.log(
        `Start: ${moment(event.start).format("YYYY-MM-DD HH:mm:ss")}`
      );
      console.log(`End: ${moment(event.end).format("YYYY-MM-DD HH:mm:ss")}`);
      if (event.location) console.log(`Location: ${event.location}`);
      if (event.recurring) console.log("(Recurring event)");
    });

    // Show distribution of events by month (only future events)
    const eventsByMonth = eventArray.reduce((acc, event) => {
      const month = moment(event.start).format("YYYY-MM");
      acc[month] = (acc[month] || 0) + 1;
      return acc;
    }, {});

    console.log("\nFuture events distribution by month:");
    Object.entries(eventsByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([month, count]) => {
        console.log(`${month}: ${count} events`);
      });

    // Memory usage statistics
    const used = process.memoryUsage();
    console.log("\nMemory usage:");
    for (let key in used) {
      console.log(
        `${key}: ${Math.round((used[key] / 1024 / 1024) * 100) / 100} MB`
      );
    }
  } catch (error) {
    console.error("Error fetching calendar:", error);
  }
}

// Run the test
console.log("Starting calendar test...");
testCalendarFetch().then(() => {
  console.log("\nTest completed.");
});
