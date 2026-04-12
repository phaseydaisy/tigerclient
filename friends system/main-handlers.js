// Friend System - Main Process Handlers
// This file contains all IPC handlers for the friend system

// Helper Functions
const readFriends = async (accountUuid) => {
  const fileName = accountUuid ? `friends-${accountUuid}.json` : FRIENDS_FILE;
  const filePath = path.join(app.getPath("userData"), fileName);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    return { friends: [], requestsSent: {}, requestsReceived: {} };
  }
};

const writeFriends = async (data, accountUuid) => {
  const fileName = accountUuid ? `friends-${accountUuid}.json` : FRIENDS_FILE;
  const filePath = path.join(app.getPath("userData"), fileName);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
};

const validateMinecraftUsername = async (username) => {
  try {
    const response = await fetchJson(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    return response && response.id && response.name;
  } catch (error) {
    return false;
  }
};

// IPC Handlers
ipcMain.handle("launcher:get-friends-data", async () => {
  try {
    const auth = await readAuth();
    const accountUuid = auth?.uuid;
    const friendsData = await readFriends(accountUuid);
    const username = auth?.name || "Player";
    
    // Process friend requests
    const requests = [];
    
    // Incoming requests
    if (friendsData.requestsReceived) {
      Object.keys(friendsData.requestsReceived).forEach(requesterUsername => {
        requests.push({
          username: requesterUsername,
          type: 'incoming'
        });
      });
    }
    
    // Outgoing requests
    if (friendsData.requestsSent) {
      Object.keys(friendsData.requestsSent).forEach(targetUsername => {
        requests.push({
          username: targetUsername,
          type: 'outgoing'
        });
      });
    }
    
    return {
      friends: friendsData.friends || [],
      requests: requests
    };
  } catch (error) {
    console.error("Error getting friends data:", error);
    return { friends: [], requests: [] };
  }
});

ipcMain.handle("launcher:add-friend", async (_event, username) => {
  try {
    const auth = await readAuth();
    const accountUuid = auth?.uuid;
    const friendsData = await readFriends(accountUuid);
    const myUsername = auth?.name || "Player";
    
    if (username === myUsername) {
      throw new Error("You can't add yourself as a friend");
    }
    
    // Check if username exists on Mojang
    const isValid = await validateMinecraftUsername(username);
    if (!isValid) {
      throw new Error(`${username} is not a valid Minecraft username`);
    }
    
    // Check if already friends
    if (friendsData.friends && friendsData.friends.some(f => f.username === username)) {
      throw new Error(`${username} is already a friend`);
    }
    
    // Check if already requested
    if (friendsData.requestsSent && friendsData.requestsSent[username]) {
      throw new Error(`Friend request to ${username} already pending`);
    }
    
    // Record the outgoing request
    if (!friendsData.requestsSent) friendsData.requestsSent = {};
    friendsData.requestsSent[username] = Date.now();
    
    await writeFriends(friendsData, accountUuid);
    return { ok: true };
  } catch (error) {
    throw new Error(error.message || "Failed to add friend");
  }
});

ipcMain.handle("launcher:accept-friend", async (_event, username) => {
  try {
    const auth = await readAuth();
    const accountUuid = auth?.uuid;
    const friendsData = await readFriends(accountUuid);
    
    // Check if request exists
    if (!friendsData.requestsReceived || !friendsData.requestsReceived[username]) {
      throw new Error("Friend request not found");
    }
    
    // Add to friends
    if (!friendsData.friends) friendsData.friends = [];
    const newFriend = {
      username: username,
      status: 'offline',
      lastSeen: Date.now(),
      currentServer: null
    };
    friendsData.friends.push(newFriend);
    
    // Remove from pending requests
    delete friendsData.requestsReceived[username];
    
    await writeFriends(friendsData, accountUuid);
    return { ok: true };
  } catch (error) {
    throw new Error(error.message || "Failed to accept friend request");
  }
});

ipcMain.handle("launcher:decline-friend", async (_event, username) => {
  try {
    const auth = await readAuth();
    const accountUuid = auth?.uuid;
    const friendsData = await readFriends(accountUuid);
    
    // Remove from incoming requests
    if (friendsData.requestsReceived && friendsData.requestsReceived[username]) {
      delete friendsData.requestsReceived[username];
    }
    
    await writeFriends(friendsData, accountUuid);
    return { ok: true };
  } catch (error) {
    throw new Error(error.message || "Failed to decline friend request");
  }
});

ipcMain.handle("launcher:remove-friend", async (_event, username) => {
  try {
    const auth = await readAuth();
    const accountUuid = auth?.uuid;
    const friendsData = await readFriends(accountUuid);
    
    if (!friendsData.friends) friendsData.friends = [];
    const index = friendsData.friends.findIndex(f => f.username === username);
    
    if (index === -1) {
      throw new Error("Friend not found");
    }
    
    friendsData.friends.splice(index, 1);
    await writeFriends(friendsData, accountUuid);
    return { ok: true };
  } catch (error) {
    throw new Error(error.message || "Failed to remove friend");
  }
});

ipcMain.handle("launcher:cancel-friend", async (_event, username) => {
  try {
    const auth = await readAuth();
    const accountUuid = auth?.uuid;
    const friendsData = await readFriends(accountUuid);
    
    // Remove from outgoing requests
    if (friendsData.requestsSent && friendsData.requestsSent[username]) {
      delete friendsData.requestsSent[username];
    }
    
    await writeFriends(friendsData, accountUuid);
    return { ok: true };
  } catch (error) {
    throw new Error(error.message || "Failed to cancel friend request");
  }
});

ipcMain.handle("launcher:update-friend-status", async (_event, status, server) => {
  try {
    const auth = await readAuth();
    const accountUuid = auth?.uuid;
    const friendsData = await readFriends(accountUuid);
    const myUsername = auth?.name || "Player";
    
    if (!friendsData.friends) friendsData.friends = [];
    
    // Update your own status for friends' view (this would be sent to other clients in a real system)
    friendsData.myStatus = {
      username: myUsername,
      status: status,
      currentServer: server,
      lastUpdated: Date.now()
    };
    
    await writeFriends(friendsData, accountUuid);
    return { ok: true };
  } catch (error) {
    console.error("Error updating friend status:", error);
    return { ok: false };
  }
});

// Debug handler to simulate receiving a friend request (for testing)
ipcMain.handle("launcher:simulate-incoming-request", async (_event, username) => {
  try {
    const auth = await readAuth();
    const accountUuid = auth?.uuid;
    const friendsData = await readFriends(accountUuid);
    
    if (!friendsData.requestsReceived) friendsData.requestsReceived = {};
    friendsData.requestsReceived[username] = Date.now();
    
    await writeFriends(friendsData, accountUuid);
    return { ok: true };
  } catch (error) {
    console.error("Error simulating incoming request:", error);
    return { ok: false };
  }
});
