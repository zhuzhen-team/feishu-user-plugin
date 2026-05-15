// src/clients/official/calendar.js
// Mixed into LarkOfficialClient.prototype by ./index.js. UAT-first for all
// methods (calendar resources are user-owned by default).

module.exports = {
  // --- Calendar read (v1.3.4) ---

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

  // --- Calendar write (v1.3.7) ---
  // Requires the 4 verb-specific scopes on app + UAT:
  //   calendar:calendar.event:create / update / delete / reply
  // Feishu has no umbrella `:write` scope — using it 422-rejects OAuth.

  async createCalendarEvent(calendarId, eventData) {
    if (!calendarId) throw new Error('createCalendarEvent: calendarId is required');
    if (!eventData?.start_time || !eventData?.end_time) {
      throw new Error('createCalendarEvent: start_time and end_time are required (each: {timestamp: "<unix-seconds>", timezone?: "Asia/Shanghai"} or {date: "YYYY-MM-DD"})');
    }
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`,
      method: 'POST',
      body: eventData,
      sdkFn: () => this.client.calendar.calendarEvent.create({
        path: { calendar_id: calendarId },
        data: eventData,
      }),
      label: 'createCalendarEvent',
    });
    const out = { event: res.data.event, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },

  async updateCalendarEvent(calendarId, eventId, updates) {
    if (!calendarId || !eventId) throw new Error('updateCalendarEvent: calendarId and eventId are required');
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      throw new Error('updateCalendarEvent: updates object is required (e.g. {summary, description, start_time, end_time, attendee_ability, ...})');
    }
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      method: 'PATCH',
      body: updates,
      sdkFn: () => this.client.calendar.calendarEvent.patch({
        path: { calendar_id: calendarId, event_id: eventId },
        data: updates,
      }),
      label: 'updateCalendarEvent',
    });
    const out = { event: res.data.event, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },

  async deleteCalendarEvent(calendarId, eventId, { needNotification, meetingChatId } = {}) {
    if (!calendarId || !eventId) throw new Error('deleteCalendarEvent: calendarId and eventId are required');
    const query = {};
    if (needNotification !== undefined) query.need_notification = String(needNotification);
    if (meetingChatId) query.meeting_chat_id = meetingChatId;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      method: 'DELETE',
      query,
      sdkFn: () => this.client.calendar.calendarEvent.delete({
        path: { calendar_id: calendarId, event_id: eventId },
        params: meetingChatId ? { meeting_chat_id: meetingChatId } : {},
      }),
      label: 'deleteCalendarEvent',
    });
    const out = { deleted: true, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },

  async respondCalendarEvent(calendarId, eventId, rsvpStatus) {
    if (!calendarId || !eventId) throw new Error('respondCalendarEvent: calendarId and eventId are required');
    if (!['accept', 'decline', 'tentative'].includes(rsvpStatus)) {
      throw new Error('respondCalendarEvent: rsvp_status must be one of accept|decline|tentative');
    }
    const body = { rsvp_status: rsvpStatus };
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/reply`,
      method: 'PATCH',
      body,
      sdkFn: () => this.client.calendar.calendarEvent.reply({
        path: { calendar_id: calendarId, event_id: eventId },
        data: body,
      }),
      label: 'respondCalendarEvent',
    });
    const out = { rsvp: rsvpStatus, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },

  async getFreebusy({ timeMin, timeMax, userIds = [], roomIds = [], includeExternalCalendar, onlyBusy } = {}) {
    if (!timeMin || !timeMax) throw new Error('getFreebusy: time_min and time_max (RFC3339 strings) are required');
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new Error('getFreebusy: user_ids array is required (use list_profiles / get_login_status to get your own open_id)');
    }
    const body = {
      time_min: timeMin,
      time_max: timeMax,
      user_ids: userIds,
    };
    if (roomIds && roomIds.length) body.room_ids = roomIds;
    if (includeExternalCalendar !== undefined) body.include_external_calendar = !!includeExternalCalendar;
    if (onlyBusy !== undefined) body.only_busy = !!onlyBusy;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/freebusy/batch_get`,
      method: 'POST',
      body,
      sdkFn: () => this.client.calendar.freebusy.batch({ data: body }),
      label: 'getFreebusy',
    });
    return { freebusyLists: res.data.freebusy_lists || [], viaUser: !!res._viaUser };
  },
};
