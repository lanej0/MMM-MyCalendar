/* MagicMirror²
 * Node Helper: Calendar - CalendarFetcher
 *
 * By Michael Teeuw https://michaelteeuw.nl
 * MIT Licensed.
 */
const CalendarUtils = require("./calendarutils");
const Log = require("logger");
const NodeHelper = require("node_helper");
const ical = require("node-ical");
const https = require("https");
const moment = require("moment");

/**
 *
 * @param {string} url The url of the calendar to fetch
 * @param {number} reloadInterval Time in ms the calendar is fetched again
 * @param {string[]} excludedEvents An array of words / phrases from event titles that will be excluded from being shown.
 * @param {number} maximumEntries The maximum number of events fetched.
 * @param {number} maximumNumberOfDays The maximum number of days an event should be in the future.
 * @param {object} auth The object containing options for authentication against the calendar.
 * @param {boolean} includePastEvents If true events from the past maximumNumberOfDays will be fetched too
 * @param {boolean} selfSignedCert If true, the server certificate is not verified against the list of supplied CAs.
 * @class
 */
const CalendarFetcher = function (
  url,
  reloadInterval,
  excludedEvents,
  maximumEntries,
  maximumNumberOfDays,
  auth,
  includePastEvents,
  selfSignedCert
) {
  let reloadTimer = null;
  let events = [];
  let currentPage = 1;
  let hasMoreEvents = true;

  let fetchFailedCallback = function () {};
  let eventsReceivedCallback = function () {};

  /**
   * Filters and sorts events based on date range
   * @param {Object} data - Raw calendar data
   * @param {number} page - Page number (1-based)
   * @param {number} pageSize - Number of events per page
   * @returns {Array} Filtered and paginated events
   */
  const processEvents = (data, page = 1, pageSize = maximumEntries) => {
    const now = new Date();
    const today = moment().startOf("day");
    const future = moment().startOf("day").add(maximumNumberOfDays, "days");
    let validEvents = [];

    // Pre-calculate date range for faster filtering
    const futureTime = future.valueOf();
    const todayTime = today.valueOf();
    const nowTime = now.getTime();

    // Convert data object to array and filter events
    Object.entries(data).forEach(([, event]) => {
      if (event.type !== "VEVENT") return;

      const startDate = moment(event.start);
      const startTime = startDate.valueOf();

      // Only include events from today forward
      if (startTime < todayTime) return;
      if (startTime > futureTime) return;

      // Handle recurring events more efficiently
      if (event.rrule) {
        try {
          // Get next 3 occurrences only, starting from today
          const occurrences = event.rrule.between(
            today.toDate(),
            future.toDate(),
            true,
            (date, i) => i < 3 // Limit to 3 occurrences
          );

          occurrences.forEach((date) => {
            validEvents.push({
              title: event.summary || "No Title",
              startDate: date.getTime(),
              endDate: moment(date)
                .add(moment(event.end).diff(moment(event.start)))
                .valueOf(),
              fullDayEvent: !event.start.hasOwnProperty("hour"),
              class: event.class || "PUBLIC",
              location: event.location || false,
              description: event.description || false,
              today: moment(date).isSame(today, "day"),
              symbol: event.symbol || false,
              recurring: true,
            });
          });
        } catch (e) {
          Log.debug("Error processing recurring event:", e);
        }
        return;
      }

      // Apply excluded events filter early
      if (
        excludedEvents.some((filter) =>
          event.summary?.toLowerCase().includes(filter.toLowerCase())
        )
      )
        return;

      validEvents.push({
        title: event.summary || "No Title",
        startDate: startTime,
        endDate: moment(event.end).valueOf(),
        fullDayEvent: !event.start.hasOwnProperty("hour"),
        class: event.class || "PUBLIC",
        location: event.location || false,
        description: event.description || false,
        today: startDate.isSame(today, "day"),
        symbol: event.symbol || false,
        recurring: false,
      });
    });

    // Sort events by start date
    validEvents.sort((a, b) => a.startDate - b.startDate);

    // Calculate pagination
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    hasMoreEvents = validEvents.length > end;

    // Store total count for UI feedback
    this.totalEvents = validEvents.length;

    return validEvents.slice(start, end);
  };

  /**
   * Initiates calendar fetch with pagination.
   */
  const fetchCalendar = () => {
    clearTimeout(reloadTimer);
    reloadTimer = null;

    // Implement progressive loading with caching
    const cacheKey = `calendar_cache_${url}`;
    const pageKey = `${cacheKey}_page_${currentPage}`;

    // Try to get cached data first
    const cachedPage = global.nodeHelper?.cache?.get(pageKey);
    const cachedMeta = global.nodeHelper?.cache?.get(cacheKey);

    if (cachedPage) {
      events = cachedPage.events;
      hasMoreEvents = cachedPage.hasMore;
      this.broadcastEvents();
    }

    // If we have metadata cached, use it to determine if we need to fetch
    if (cachedMeta && cachedMeta.lastFetch > Date.now() - reloadInterval) {
      scheduleTimer();
      return;
    }

    const headers = {
      "User-Agent": `MagicMirror/${global.version} (Node.js ${process.version})`,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    if (auth) {
      headers.Authorization =
        auth.method === "bearer"
          ? `Bearer ${auth.pass}`
          : `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString(
              "base64"
            )}`;
    }

    const requestOptions = {
      headers,
      agent: selfSignedCert
        ? new https.Agent({ rejectUnauthorized: false })
        : null,
      timeout: 10000, // 10 second timeout
    };

    // Use native https.get instead of node-fetch
    const request = https.get(url, requestOptions, (response) => {
      let data = "";

      // Handle HTTP status codes
      if (response.statusCode < 200 || response.statusCode >= 400) {
        const error = new Error(
          `Request failed with status code ${response.statusCode}`
        );
        error.response = response;
        fetchFailedCallback(this, error);
        scheduleTimer();
        return;
      }

      response.on("data", (chunk) => {
        data += chunk;
      });

      response.on("end", () => {
        try {
          const calendarData = ical.parseICS(data);
          const processedEvents = processEvents(
            data,
            currentPage,
            maximumEntries
          );

          events = processedEvents;

          // Cache the processed events and metadata
          if (global.nodeHelper?.cache) {
            // Cache individual page
            global.nodeHelper.cache.set(
              pageKey,
              {
                events: processedEvents,
                hasMore: hasMoreEvents,
                totalEvents: this.totalEvents,
              },
              reloadInterval
            );

            // Cache metadata
            global.nodeHelper.cache.set(
              cacheKey,
              {
                lastFetch: Date.now(),
                totalPages: Math.ceil(this.totalEvents / maximumEntries),
              },
              reloadInterval
            );
          }

          this.broadcastEvents();
        } catch (error) {
          Log.error("Calendar Fetcher Error:", error);
          fetchFailedCallback(this, error);
        }
        scheduleTimer();
      });
    });

    // Handle request errors
    request.on("error", (error) => {
      Log.error("Calendar Fetch Failed:", error);
      fetchFailedCallback(this, error);
      scheduleTimer();
    });

    // Handle timeout
    request.on("timeout", () => {
      request.destroy();
      const error = new Error("Request timeout");
      Log.error("Calendar Fetch Timeout:", error);
      fetchFailedCallback(this, error);
      scheduleTimer();
    });

    request.end();
  };

  /**
   * Schedule the timer for the next update.
   */
  const scheduleTimer = function () {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      fetchCalendar();
    }, reloadInterval);
  };

  /* public methods */

  /**
   * Initiate fetchCalendar();
   */
  this.startFetch = function () {
    fetchCalendar();
  };

  /**
   * Broadcast the existing events.
   */
  this.broadcastEvents = function () {
    Log.info("Calendar-Fetcher: Broadcasting " + events.length + " events.");
    eventsReceivedCallback(this);
  };

  /**
   * Sets the on success callback
   *
   * @param {Function} callback The on success callback.
   */
  this.onReceive = function (callback) {
    eventsReceivedCallback = callback;
  };

  /**
   * Sets the on error callback
   *
   * @param {Function} callback The on error callback.
   */
  this.onError = function (callback) {
    fetchFailedCallback = callback;
  };

  /**
   * Returns the url of this fetcher.
   *
   * @returns {string} The url of this fetcher.
   */
  this.url = function () {
    return url;
  };

  /**
   * Returns current available events for this fetcher.
   *
   * @returns {object[]} The current available events for this fetcher.
   */
  this.events = function () {
    return events;
  };

  /**
   * Loads the next page of events
   */
  this.loadNextPage = function () {
    if (!hasMoreEvents) return;
    currentPage++;
    fetchCalendar();
  };

  /**
   * Returns whether there are more events available
   */
  this.hasMoreEvents = function () {
    return hasMoreEvents;
  };

  /**
   * Resets pagination to first page
   */
  this.resetPagination = function () {
    currentPage = 1;
    hasMoreEvents = true;
    fetchCalendar();
  };
};

module.exports = CalendarFetcher;
