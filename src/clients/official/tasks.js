// src/clients/official/tasks.js — Feishu Tasks v2 API.
//
// Feishu's Task v2 API. Reference:
//   https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/task/overview
//
// All methods are UAT-first since tasks are user-owned by default. Requires
// `task:task` scope on the OAuth.
//
// Note on identifiers: v2 uses `task_guid` (not numeric task_id like v1). All
// our methods accept and return guid strings.
//
// Note on completion: there is no separate `complete()` endpoint in v2 —
// completion is a `patch` setting `completed_at` to a unix-millis string
// ("0" to uncomplete) plus update_fields=['completed_at'].

function _applyPageTokenInvariant(out, token) {
  if (!out.hasMore) return out;
  if (token) {
    out.pageToken = token;
    return out;
  }
  out.hasMore = false;
  out.truncated = true;
  out.cursorUnavailable = true;
  return out;
}

module.exports = {
  async listTasks({ completed, type, pageSize, pageToken } = {}) {
    const params = {};
    if (completed !== undefined) params.completed = String(!!completed);
    if (type) params.type = type;
    if (pageSize) params.page_size = String(pageSize);
    if (pageToken) params.page_token = pageToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/task/v2/tasks`,
      method: 'GET',
      query: params,
      sdkFn: () => this.client.task.v2.task.list({
        params: {
          ...(completed !== undefined ? { completed: !!completed } : {}),
          ...(type ? { type } : {}),
          ...(pageSize ? { page_size: pageSize } : {}),
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      }),
      label: 'listTasks',
    });
    return _applyPageTokenInvariant({
      items: res.data.items || [],
      hasMore: !!res.data.has_more,
    }, res.data.page_token);
  },

  async getTask(taskGuid) {
    if (!taskGuid) throw new Error('getTask: task_guid is required');
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/task/v2/tasks/${encodeURIComponent(taskGuid)}`,
      method: 'GET',
      sdkFn: () => this.client.task.v2.task.get({ path: { task_guid: taskGuid } }),
      label: 'getTask',
    });
    return { task: res.data.task };
  },

  async createTask(taskData) {
    if (!taskData?.summary) throw new Error('createTask: summary is required');
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/task/v2/tasks`,
      method: 'POST',
      body: taskData,
      sdkFn: () => this.client.task.v2.task.create({ data: taskData }),
      label: 'createTask',
    });
    const out = { task: res.data.task, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },

  async updateTask(taskGuid, taskUpdates, updateFields) {
    if (!taskGuid) throw new Error('updateTask: task_guid is required');
    if (!Array.isArray(updateFields) || updateFields.length === 0) {
      throw new Error('updateTask: update_fields array is required (e.g. ["summary","due","completed_at"]) — Feishu only patches the listed fields.');
    }
    const body = { task: taskUpdates || {}, update_fields: updateFields };
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/task/v2/tasks/${encodeURIComponent(taskGuid)}`,
      method: 'PATCH',
      body,
      sdkFn: () => this.client.task.v2.task.patch({
        path: { task_guid: taskGuid },
        data: body,
      }),
      label: 'updateTask',
    });
    const out = { task: res.data.task, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },

  // completed=true marks done now; completed=false un-completes (sets completed_at to "0")
  async completeTask(taskGuid, completed = true) {
    if (!taskGuid) throw new Error('completeTask: task_guid is required');
    const completedAt = completed ? String(Date.now()) : '0';
    return this.updateTask(taskGuid, { completed_at: completedAt }, ['completed_at']);
  },

  async deleteTask(taskGuid) {
    if (!taskGuid) throw new Error('deleteTask: task_guid is required');
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/task/v2/tasks/${encodeURIComponent(taskGuid)}`,
      method: 'DELETE',
      sdkFn: () => this.client.task.v2.task.delete({ path: { task_guid: taskGuid } }),
      label: 'deleteTask',
    });
    const out = { deleted: true, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },

  // members: array of {id, type?, role, name?}. role is typically "assignee" or "follower".
  async addTaskMembers(taskGuid, members) {
    if (!taskGuid) throw new Error('addTaskMembers: task_guid is required');
    if (!Array.isArray(members) || members.length === 0) throw new Error('addTaskMembers: members array required ({id, role}, role=assignee|follower)');
    const body = { members };
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/task/v2/tasks/${encodeURIComponent(taskGuid)}/add_members`,
      method: 'POST',
      body,
      sdkFn: () => this.client.task.v2.task.addMembers({
        path: { task_guid: taskGuid },
        data: body,
      }),
      label: 'addTaskMembers',
    });
    const out = { task: res.data.task, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },

  async removeTaskMembers(taskGuid, members) {
    if (!taskGuid) throw new Error('removeTaskMembers: task_guid is required');
    if (!Array.isArray(members) || members.length === 0) throw new Error('removeTaskMembers: members array required');
    const body = { members };
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/task/v2/tasks/${encodeURIComponent(taskGuid)}/remove_members`,
      method: 'POST',
      body,
      sdkFn: () => this.client.task.v2.task.removeMembers({
        path: { task_guid: taskGuid },
        data: body,
      }),
      label: 'removeTaskMembers',
    });
    const out = { task: res.data.task, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },
};
