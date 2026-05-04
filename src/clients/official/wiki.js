// src/clients/official/wiki.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, etc. — all defined in base.js.

module.exports = {
  // --- Wiki ---

  async listWikiSpaces() {
    const res = await this._safeSDKCall(() => this.client.wiki.space.list({ params: { page_size: 50 } }), 'listSpaces');
    return { items: res.data.items || [] };
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
