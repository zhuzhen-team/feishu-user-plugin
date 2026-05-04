// src/clients/official/calendar.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, etc. — all defined in base.js.

module.exports = {
  // --- Calendar (v1.3.4) ---

  async listCalendars({ pageSize = 50, pageToken, syncToken } = {}) {
    // Feishu's calendar/v4/calendars endpoint rejects page_size < 50 with
    // `99992402 field validation failed` ("the min value is 50"). The docs don't
    // flag this — smoke-tested against the real API. Clamp to be safe.
    const ps = Math.max(50, Number(pageSize) || 50);
    const params = { page_size: String(ps) };
    if (pageToken) params.page_token = pageToken;
    if (syncToken) params.sync_token = syncToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/calendars`,
      query: params,
      sdkFn: () => this.client.calendar.calendar.list({ params: { page_size: ps, ...(pageToken ? { page_token: pageToken } : {}), ...(syncToken ? { sync_token: syncToken } : {}) } }),
      label: 'listCalendars',
    });
    return {
      items: res.data.calendar_list || [],
      pageToken: res.data.page_token,
      syncToken: res.data.sync_token,
      hasMore: res.data.has_more,
    };
  },

  async listCalendarEvents(calendarId, { startTime, endTime, pageSize = 50, pageToken, syncToken } = {}) {
    if (!calendarId) throw new Error('listCalendarEvents: calendarId is required');
    const params = { page_size: String(pageSize) };
    if (startTime) params.start_time = String(startTime);
    if (endTime) params.end_time = String(endTime);
    if (pageToken) params.page_token = pageToken;
    if (syncToken) params.sync_token = syncToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`,
      query: params,
      sdkFn: () => this.client.calendar.calendarEvent.list({
        path: { calendar_id: calendarId },
        params: {
          page_size: pageSize,
          ...(startTime ? { start_time: String(startTime) } : {}),
          ...(endTime ? { end_time: String(endTime) } : {}),
          ...(pageToken ? { page_token: pageToken } : {}),
          ...(syncToken ? { sync_token: syncToken } : {}),
        },
      }),
      label: 'listCalendarEvents',
    });
    return {
      items: res.data.items || [],
      pageToken: res.data.page_token,
      syncToken: res.data.sync_token,
      hasMore: res.data.has_more,
    };
  },

  async getCalendarEvent(calendarId, eventId) {
    if (!calendarId || !eventId) throw new Error('getCalendarEvent: calendarId and eventId are required');
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      sdkFn: () => this.client.calendar.calendarEvent.get({ path: { calendar_id: calendarId, event_id: eventId } }),
      label: 'getCalendarEvent',
    });
    return { event: res.data.event };
  },
};
