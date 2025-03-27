/***************************************

  Module: MMM-MyCalendar
  By Jeff Clarke
 
  Based on the default Calendar module
  By Michael Teeuw http://michaelteeuw.nl
 
  MIT Licensed.

***************************************/

Module.register("MMM-MyCalendar", {
  // Define module defaults
  defaults: {
    maximumEntries: 10, // Total Maximum Entries
    maximumNumberOfDays: 365,
    limitDays: 0,
    displaySymbol: true,
    defaultSymbol: "calendar", // Fontawesome Symbol see http://fontawesome.io/cheatsheet/
    displayRepeatingCountTitle: false,
    defaultRepeatingCountTitle: "",
    maxTitleLength: 25,
    maxLocationTitleLength: 25,
    wrapEvents: false,
    wrapLocationEvents: false,
    maxTitleLines: 3,
    maxEventTitleLines: 3,
    includePastEvents: false,
    fetchInterval: 5 * 60 * 1000, // Update every 5 minutes.
    animationSpeed: 2000,
    fade: true,
    urgency: 7,
    useRelativeDates: false,
    dayOfWeekFormat: "dddd",
    dateFormat: "MMMM D",
    timeFormat: "h:mm A",
    joiningWord: "at",
    getRelative: 6,
    fadePoint: 0.25, // Start on 1/4th of the list.
    hidePrivate: false,
    colored: false,
    showLoadMore: true, // Whether to show the Load More button
    loadMoreText: "LOAD_MORE", // Translation key for Load More button
    calendars: [
      {
        symbol: "calendar",
        url: "http://www.calendarlabs.com/templates/ical/US-Holidays.ics",
      },
    ],
    titleReplace: {
      "De verjaardag van ": "",
      "'s birthday": "",
    },
    broadcastEvents: true,
    excludedEvents: [],
    showLocation: true,
    showPagination: true, // New option to show/hide pagination
    paginationPosition: "bottom", // 'top', 'bottom', or 'both'
    showEventCount: true, // Show total event count
  },

  // Define required scripts.
  getStyles: function () {
    return ["MMM-MyCalendar.css", "font-awesome.css"];
  },

  // Define required scripts.
  getScripts: function () {
    return ["moment.js"];
  },

  // Define required translations.
  getTranslations: function () {
    // The translations for the default modules are defined in the core translation files.
    // Therefor we can just return false. Otherwise we should have returned a dictionary.
    // If you're trying to build your own module including translations, check out the documentation.
    return false;
  },

  // Override start method.
  start: function () {
    Log.log("Starting module: " + this.name);

    // Set locale.
    moment.locale(config.language);

    // Initialize state
    this.loaded = false;
    this.calendarData = {};
    this.pendingFetches = 0;

    // Defer calendar loading
    setTimeout(() => {
      this.loadCalendars();
    }, 1000);

    // Show initial loading state immediately
    this.updateDom(0);
  },

  loadCalendars: function () {
    for (var c in this.config.calendars) {
      var calendar = this.config.calendars[c];
      calendar.url = calendar.url.replace("webcal://", "http://");

      var calendarConfig = {
        maximumEntries: calendar.maximumEntries,
        maximumNumberOfDays: calendar.maximumNumberOfDays,
      };

      if (calendar.user && calendar.pass) {
        calendar.auth = {
          user: calendar.user,
          pass: calendar.pass,
        };
      }

      this.pendingFetches++;
      this.addCalendar(calendar.url, calendar.auth, calendarConfig);
    }
  },

  // Override socket notification handler.
  socketNotificationReceived: function (notification, payload) {
    if (notification === "CALENDAR_EVENTS") {
      if (this.hasCalendarURL(payload.url)) {
        // Merge new events with existing ones if we're paginating
        if (payload.page > 1) {
          this.calendarData[payload.url] = [
            ...(this.calendarData[payload.url] || []),
            ...payload.events,
          ];
        } else {
          this.calendarData[payload.url] = payload.events;
        }

        this.pendingFetches--;

        if (this.pendingFetches === 0) {
          this.loaded = true;
        }

        if (this.config.broadcastEvents) {
          this.broadcastEvents();
        }
      }
    } else if (notification === "FETCH_ERROR") {
      Log.error("Calendar Error. Could not fetch calendar: " + payload.url);
      this.pendingFetches--;
    } else if (notification === "INCORRECT_URL") {
      Log.error("Calendar Error. Incorrect url: " + payload.url);
      this.pendingFetches--;
    } else {
      Log.log(
        "Calendar received an unknown socket notification: " + notification
      );
    }

    this.updateDom(this.config.animationSpeed);
  },

  // Override dom generator.
  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "calendar-container";

    if (this.loading) {
      const loadingText = document.createElement("div");
      loadingText.innerHTML = this.translate("LOADING");
      loadingText.className = "dimmed light small";
      wrapper.appendChild(loadingText);
      return wrapper;
    }

    if (this.config.showEventCount && this.totalEvents !== undefined) {
      const countDiv = document.createElement("div");
      countDiv.className = "event-count dimmed light xsmall";
      countDiv.innerHTML = `${this.translate("TOTAL_EVENTS")}: ${
        this.totalEvents
      }`;
      wrapper.appendChild(countDiv);
    }

    if (
      this.config.showPagination &&
      (this.config.paginationPosition === "top" ||
        this.config.paginationPosition === "both")
    ) {
      wrapper.appendChild(this.createPaginationControls());
    }

    const eventList = document.createElement("div");
    eventList.className = "calendar-events";

    if (!this.events || this.events.length === 0) {
      const noEventsDiv = document.createElement("div");
      noEventsDiv.className = "small dimmed";
      noEventsDiv.innerHTML = this.translate("EVENTS_NOT_FOUND");
      eventList.appendChild(noEventsDiv);
    } else {
      const table = document.createElement("table");
      table.className = "small";

      for (let e of this.events) {
        const eventWrapper = this.createEventRow(e);
        table.appendChild(eventWrapper);
      }

      eventList.appendChild(table);

      // Fade effect
      if (this.config.fadePoint < 1) {
        const fadeStart = this.config.fadePoint * table.rows.length;
        const fadeSteps = 1 / (table.rows.length - fadeStart);

        for (let i = fadeStart; i < table.rows.length; i++) {
          const currentStep = i - fadeStart;
          table.rows[i].style.opacity = 1 - currentStep * fadeSteps;
        }
      }
    }

    wrapper.appendChild(eventList);

    if (
      this.config.showPagination &&
      (this.config.paginationPosition === "bottom" ||
        this.config.paginationPosition === "both")
    ) {
      wrapper.appendChild(this.createPaginationControls());
    }

    return wrapper;
  },

  createEventRow: function (event) {
    const eventWrapper = document.createElement("tr");
    eventWrapper.className = "normal";

    if (this.config.displaySymbol) {
      const symbolWrapper = document.createElement("td");
      symbolWrapper.className = "symbol align-right";
      const symbol = document.createElement("span");
      symbol.className =
        "fa fa-fw fa-" + (event.symbol || this.config.defaultSymbol);
      symbolWrapper.appendChild(symbol);
      eventWrapper.appendChild(symbolWrapper);
    }

    const titleWrapper = document.createElement("td");
    titleWrapper.className = "title bright";
    titleWrapper.style.maxWidth = "100%";

    const title = document.createElement("div");
    title.className = "event-title";
    title.style.maxWidth = "100%";

    if (this.config.wrapEvents) {
      title.style.whiteSpace = "normal";
      title.style.wordBreak = "break-word";
      title.style.display = "-webkit-box";
      title.style.webkitLineClamp = this.config.maxTitleLines;
      title.style.webkitBoxOrient = "vertical";
      title.style.overflow = "hidden";
    }

    title.innerHTML = this.titleTransform(
      event.title,
      this.config.maxTitleLength
    );
    titleWrapper.appendChild(title);

    if (event.location && this.config.showLocation) {
      const locationDiv = document.createElement("div");
      locationDiv.className = "event-location xsmall dimmed";
      locationDiv.innerHTML = event.location;

      if (this.config.wrapLocationEvents) {
        locationDiv.style.whiteSpace = "normal";
        locationDiv.style.wordBreak = "break-word";
      }

      titleWrapper.appendChild(locationDiv);
    }

    eventWrapper.appendChild(titleWrapper);

    const timeWrapper = document.createElement("td");
    timeWrapper.className = "time light";
    timeWrapper.innerHTML = this.capFirst(this.formatTime(event));
    eventWrapper.appendChild(timeWrapper);

    return eventWrapper;
  },

  createPaginationControls: function () {
    const controls = document.createElement("div");
    controls.className = "pagination-controls small dimmed";

    const prevBtn = document.createElement("span");
    prevBtn.className =
      "pagination-btn" + (this.currentPage <= 1 ? " disabled" : "");
    prevBtn.innerHTML = "❮";
    prevBtn.addEventListener("click", () => {
      if (this.currentPage > 1) {
        this.sendSocketNotification("CALENDAR_PAGE", {
          page: this.currentPage - 1,
          url: this.config.url,
        });
      }
    });

    const pageInfo = document.createElement("span");
    pageInfo.className = "page-info";
    pageInfo.innerHTML = ` ${this.translate("PAGE")} ${this.currentPage} `;

    const nextBtn = document.createElement("span");
    nextBtn.className =
      "pagination-btn" + (!this.hasMoreEvents ? " disabled" : "");
    nextBtn.innerHTML = "❯";
    nextBtn.addEventListener("click", () => {
      if (this.hasMoreEvents) {
        this.sendSocketNotification("CALENDAR_PAGE", {
          page: this.currentPage + 1,
          url: this.config.url,
        });
      }
    });

    controls.appendChild(prevBtn);
    controls.appendChild(pageInfo);
    controls.appendChild(nextBtn);

    return controls;
  },

  /* hasCalendarURL(url)
   * Check if this config contains the calendar url.
   *
   * argument url string - Url to look for.
   *
   * return bool - Has calendar url
   */
  hasCalendarURL: function (url) {
    for (var c in this.config.calendars) {
      var calendar = this.config.calendars[c];
      if (calendar.url === url) {
        return true;
      }
    }

    return false;
  },

  /* createEventList()
   * Creates the sorted list of all events.
   *
   * return array - Array with events.
   */
  createEventList: function () {
    var events = [];
    var today = moment().startOf("day");
    for (var c in this.calendarData) {
      var calendar = this.calendarData[c];
      for (var e in calendar) {
        var event = calendar[e];
        if (this.config.hidePrivate) {
          if (event.class === "PRIVATE") {
            // do not add the current event, skip it
            continue;
          }
        }
        event.url = c;
        event.today =
          event.startDate >= today &&
          event.startDate < today + 24 * 60 * 60 * 1000;
        events.push(event);
      }
    }

    events.sort(function (a, b) {
      return a.startDate - b.startDate;
    });

    return events.slice(0, this.config.maximumEntries);
  },

  /* createEventList(url)
   * Requests node helper to add calendar url.
   *
   * argument url string - Url to add.
   */
  addCalendar: function (url, auth, calendarConfig) {
    this.sendSocketNotification("ADD_CALENDAR", {
      url: url,
      maximumEntries:
        calendarConfig.maximumEntries || this.config.maximumEntries,
      maximumNumberOfDays:
        calendarConfig.maximumNumberOfDays || this.config.maximumNumberOfDays,
      fetchInterval: this.config.fetchInterval,
      auth: auth,
    });
  },

  /* symbolsForUrl(url)
   * Retrieves the symbols for a specific url.
   *
   * argument url string - Url to look for.
   *
   * return string/array - The Symbols
   */
  symbolsForUrl: function (url) {
    return this.getCalendarProperty(url, "symbol", this.config.defaultSymbol);
  },

  /* colorForUrl(url)
   * Retrieves the color for a specific url.
   *
   * argument url string - Url to look for.
   *
   * return string - The Color
   */
  colorForUrl: function (url) {
    return this.getCalendarProperty(url, "color", "#fff");
  },

  /* countTitleForUrl(url)
   * Retrieves the name for a specific url.
   *
   * argument url string - Url to look for.
   *
   * return string - The Symbol
   */
  countTitleForUrl: function (url) {
    return this.getCalendarProperty(
      url,
      "repeatingCountTitle",
      this.config.defaultRepeatingCountTitle
    );
  },

  /* getCalendarProperty(url, property, defaultValue)
   * Helper method to retrieve the property for a specific url.
   *
   * argument url string - Url to look for.
   * argument property string - Property to look for.
   * argument defaultValue string - Value if property is not found.
   *
   * return string - The Property
   */
  getCalendarProperty: function (url, property, defaultValue) {
    for (var c in this.config.calendars) {
      var calendar = this.config.calendars[c];
      if (calendar.url === url && calendar.hasOwnProperty(property)) {
        return calendar[property];
      }
    }

    return defaultValue;
  },

  /* shorten(string, maxLength)
   * Shortens a string if it's longer than maxLength.
   * Adds an ellipsis to the end.
   *
   * argument string string - The string to shorten.
   * argument maxLength number - The max length of the string.
   *
   * return string - The shortened string.
   */
  shorten: function (string, maxLength) {
    if (string.length > maxLength) {
      return string.slice(0, maxLength) + "&hellip;";
    }

    return string;
  },

  /* capFirst(string)
   * Capitalize the first letter of a string
   * Return capitalized string
   */

  capFirst: function (string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  },

  /* titleTransform(title)
   * Transforms the title of an event for usage.
   * Replaces parts of the text as defined in config.titleReplace.
   * Shortens title based on config.maxTitleLength
   *
   * argument title string - The title to transform.
   *
   * return string - The transformed title.
   */
  titleTransform: function (title, maxLength) {
    for (var needle in this.config.titleReplace) {
      var replacement = this.config.titleReplace[needle];

      var regParts = needle.match(/^\/(.+)\/([gim]*)$/);
      if (regParts) {
        // the parsed pattern is a regexp.
        needle = new RegExp(regParts[1], regParts[2]);
      }

      title = title.replace(needle, replacement);
    }

    title = this.shorten(title, maxLength || this.config.maxTitleLength);
    return title;
  },

  /* broadcastEvents()
   * Broadcasts the events to all other modules for reuse.
   * The all events available in one array, sorted on startdate.
   */
  broadcastEvents: function () {
    var eventList = [];
    for (url in this.calendarData) {
      var calendar = this.calendarData[url];
      for (e in calendar) {
        var event = cloneObject(calendar[e]);
        delete event.url;
        eventList.push(event);
      }
    }

    eventList.sort(function (a, b) {
      return a.startDate - b.startDate;
    });

    this.sendNotification("CALENDAR_EVENTS", eventList);
  },

  // Add new methods for pagination
  hasMoreEvents: function () {
    return Object.values(this.calendarData).some(
      (calendar) => calendar.hasMoreEvents
    );
  },

  loadMoreEvents: function () {
    for (var c in this.config.calendars) {
      var calendar = this.config.calendars[c];
      this.sendSocketNotification("LOAD_MORE_EVENTS", {
        url: calendar.url,
        maximumEntries: calendar.maximumEntries || this.config.maximumEntries,
        maximumNumberOfDays:
          calendar.maximumNumberOfDays || this.config.maximumNumberOfDays,
      });
    }
  },
});
