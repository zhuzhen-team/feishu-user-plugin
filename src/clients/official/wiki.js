// src/clients/official/wiki.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, etc. — all defined in base.js.

module.exports = {
  // --- Wiki ---

  async listWikiSpaces() {
    // Try UAT first — most users access only their own / team Wiki spaces
    // which the bot may not have been invited to. Falling back to app keeps
    // the bot-shared-spaces case working too.
    const res = await this._asUserOrApp({
      uatPath: '/open-apis/wiki/v2/spaces?page_size=50',
      method: 'GET',
      sdkFn: () => this.client.wiki.space.list({ params: { page_size: 50 } }),
      label: 'listSpaces',
    });
    const items = res.data.items || [];
    const out = { items, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    // Empty + bot path means scope is missing; surface a clear hint instead
    // of silently returning nothing.
    if (items.length === 0 && !res._viaUser) {
      out.scopeHint = 'No spaces returned via app — the bot likely lacks `wiki:wiki:readonly` scope, or has not been invited to any Wiki space. Run `npx feishu-user-plugin oauth` and ensure the wiki scope is granted; or invite the bot to the target Wiki space.';
    }
    return out;
  },

  async searchWiki(query) {
    const res = await this._safeSDKCall(
      () => this.client.request({ method: 'POST', url: '/open-apis/suite/docs-api/search/object', data: { search_key: query, count: 20, offset: 0, owner_ids: [], chat_ids: [], docs_types: ['wiki'] } }),
      'searchWiki'
    );
    return { items: res.data.docs_entities || [] };
  },

  // Resolves a wiki node token to its underlying object (docx / sheet / bitable / ...).
  // `spaceId` argument is kept for backward compatibility but isn't used — the Feishu
  // endpoint `wiki.v2.getNode` takes only the token.
  //
  // Accepts both wiki node tokens (wikcnXXX from list_wiki_nodes) and underlying
  // obj_tokens (docxXXX / bascnXXX from search_wiki). For obj_tokens the wiki
  // endpoint returns 95300x errors; the handler in tools/wiki.js detects this
  // and returns a synthesized node-shaped result so callers don't have to know
  // which ID space they're holding.
  async getWikiNode(nodeToken, _spaceId) {
    const res = await this._safeSDKCall(() => this.client.wiki.space.getNode({ params: { token: nodeToken } }), 'getNode');
    return res.data.node;
  },

  async listWikiNodes(spaceId, { parentNodeToken, pageToken } = {}) {
    const params = { page_size: 50 };
    if (parentNodeToken) params.parent_node_token = parentNodeToken;
    if (pageToken) params.page_token = pageToken;
    const res = await this._safeSDKCall(
      () => this.client.wiki.spaceNode.list({ path: { space_id: spaceId }, params }),
      'listNodes'
    );
    return { items: res.data.items || [], hasMore: res.data.has_more };
  },

  // --- Wiki write (v1.3.7) ---

  // Create a new node inside a Wiki space. obj_type picks the underlying
  // resource (docx / sheet / bitable / mindnote / file / slides). For
  // node_type='shortcut' the caller must also pass origin_node_token to
  // point at an existing node.
  async createWikiNode(spaceId, { obj_type, node_type = 'origin', parent_node_token, origin_node_token, title } = {}) {
    if (!spaceId) throw new Error('createWikiNode: spaceId is required');
    if (!obj_type) throw new Error('createWikiNode: obj_type is required (doc/sheet/bitable/mindnote/file/docx/slides)');
    if (node_type === 'shortcut' && !origin_node_token) {
      throw new Error('createWikiNode: origin_node_token is required when node_type=shortcut');
    }
    const data = { obj_type, node_type };
    if (parent_node_token) data.parent_node_token = parent_node_token;
    if (origin_node_token) data.origin_node_token = origin_node_token;
    if (title) data.title = title;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.wiki.spaceNode.create({ path: { space_id: spaceId }, data }),
      label: 'createWikiNode',
    });
    return { node: res.data.node, viaUser: !!res._viaUser, fallbackWarning: res._fallbackWarning || null };
  },

  // Rename a wiki node. Feishu's SDK exposes this as updateTitle (the
  // underlying API is /open-apis/wiki/v2/spaces/{space_id}/nodes/{token}/update_title).
  async updateWikiNodeTitle(spaceId, nodeToken, title) {
    if (!spaceId) throw new Error('updateWikiNodeTitle: spaceId is required');
    if (!nodeToken) throw new Error('updateWikiNodeTitle: nodeToken is required');
    if (!title) throw new Error('updateWikiNodeTitle: title is required');
    const data = { title };
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeToken)}/update_title`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.wiki.spaceNode.updateTitle({ path: { space_id: spaceId, node_token: nodeToken }, data }),
      label: 'updateWikiNodeTitle',
    });
    return { ok: res.code === 0, viaUser: !!res._viaUser, fallbackWarning: res._fallbackWarning || null };
  },

  // Move a wiki node to a different parent or different space.
  async moveWikiNode(spaceId, nodeToken, { target_parent_token, target_space_id } = {}) {
    if (!spaceId) throw new Error('moveWikiNode: spaceId is required');
    if (!nodeToken) throw new Error('moveWikiNode: nodeToken is required');
    if (!target_parent_token && !target_space_id) {
      throw new Error('moveWikiNode: at least one of target_parent_token or target_space_id is required');
    }
    const data = {};
    if (target_parent_token) data.target_parent_token = target_parent_token;
    if (target_space_id) data.target_space_id = target_space_id;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeToken)}/move`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.wiki.spaceNode.move({ path: { space_id: spaceId, node_token: nodeToken }, data }),
      label: 'moveWikiNode',
    });
    return { node: res.data.node, viaUser: !!res._viaUser, fallbackWarning: res._fallbackWarning || null };
  },

  // Copy a wiki node — deep copies the underlying resource into the target
  // location. target_parent_token / target_space_id select the destination;
  // omitting target_space_id keeps it within the source space.
  async copyWikiNode(spaceId, nodeToken, { target_parent_token, target_space_id, title } = {}) {
    if (!spaceId) throw new Error('copyWikiNode: spaceId is required');
    if (!nodeToken) throw new Error('copyWikiNode: nodeToken is required');
    const data = {};
    if (target_parent_token) data.target_parent_token = target_parent_token;
    if (target_space_id) data.target_space_id = target_space_id;
    if (title) data.title = title;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeToken)}/copy`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.wiki.spaceNode.copy({ path: { space_id: spaceId, node_token: nodeToken }, data }),
      label: 'copyWikiNode',
    });
    return { node: res.data.node, viaUser: !!res._viaUser, fallbackWarning: res._fallbackWarning || null };
  },

  // --- Wiki attach (v1.3.4) ---

  // Move an existing drive resource (docx / bitable / sheet / ...) into a Wiki
  // space as an 'origin' node. Used by createDoc / createBitable when their
  // wikiSpaceId option is set.
  //
  // Uses wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki — the documented path
  // for migrating an existing drive doc into wiki. Note: this endpoint is async;
  // if the move completes immediately (typical for newly-created docs) we get
  // back a wiki_token and surface it as node_token. If it's queued we return
  // { task_id } so the caller can see the async state — we don't currently poll.
  async attachToWiki(spaceId, objType, objToken, parentNodeToken) {
    if (!spaceId) throw new Error('attachToWiki: spaceId is required');
    if (!objType) throw new Error('attachToWiki: objType is required');
    if (!objToken) throw new Error('attachToWiki: objToken is required');
    const body = { obj_type: objType, obj_token: objToken, apply: true };
    if (parentNodeToken) body.parent_wiki_token = parentNodeToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/move_docs_to_wiki`,
      method: 'POST',
      body,
      sdkFn: () => this.client.wiki.spaceNode.moveDocsToWiki({ path: { space_id: spaceId }, data: body }),
      label: 'attachToWiki',
    });
    const data = res.data || {};
    if (data.wiki_token) return { node_token: data.wiki_token, applied: !!data.applied };
    if (data.task_id) return { task_id: data.task_id, applied: false };
    return data;
  },
};
