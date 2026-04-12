// Friend System - Preload IPC Bridges
// Add these to the contextBridge.exposeInMainWorld("launcher", { ... }) object:

/*
  getFriendsData: () => ipcRenderer.invoke("launcher:get-friends-data"),
  addFriend: (username) => ipcRenderer.invoke("launcher:add-friend", username),
  acceptFriend: (username) => ipcRenderer.invoke("launcher:accept-friend", username),
  declineFriend: (username) => ipcRenderer.invoke("launcher:decline-friend", username),
  removeFriend: (username) => ipcRenderer.invoke("launcher:remove-friend", username),
  cancelFriend: (username) => ipcRenderer.invoke("launcher:cancel-friend", username),
  updateFriendStatus: (status, server) => ipcRenderer.invoke("launcher:update-friend-status", status, server),
  simulateIncomingRequest: (username) => ipcRenderer.invoke("launcher:simulate-incoming-request", username)
*/
