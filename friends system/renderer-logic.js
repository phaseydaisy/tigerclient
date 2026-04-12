// Friend System - Renderer Logic
// This file contains all frontend friend system code

// State (add to main state object)
const friendsState = {
  currentRequestType: "incoming",
};

// Friend Loading Function
const loadFriendsAndRequests = async () => {
  try {
    const data = await window.launcher.getFriendsData();
    
    // Separate incoming and outgoing requests
    const incomingRequests = (data.requests || []).filter(req => req.type === 'incoming');
    const outgoingRequests = (data.requests || []).filter(req => req.type === 'outgoing');
    
    // Display requests based on current type
    const requestsToDisplay = state.currentRequestType === 'incoming' ? incomingRequests : outgoingRequests;
    const emptyMessage = state.currentRequestType === 'incoming' ? 'No incoming requests' : 'No outgoing requests';
    
    if (requestsToDisplay.length === 0) {
      elements.friendRequestsList.innerHTML = `<div class="empty">${emptyMessage}</div>`;
    } else {
      elements.friendRequestsList.innerHTML = requestsToDisplay.map(req => `
        <div class="friend-request-item">
          <div class="friend-request-info">
            <div>
              <div class="friend-request-name">${req.username}</div>
              <div class="friend-request-type">${req.type === 'incoming' ? 'Sent you a request' : 'Awaiting response'}</div>
            </div>
          </div>
          <div class="friend-request-actions">
            ${req.type === 'incoming' ? `
              <button class="friend-request-btn accept" data-username="${req.username}" data-action="accept">✓ Accept</button>
              <button class="friend-request-btn decline" data-username="${req.username}" data-action="decline">✕ Decline</button>
            ` : `
              <button class="friend-request-btn decline" data-username="${req.username}" data-action="cancel">✕ Cancel</button>
            `}
          </div>
        </div>
      `).join('');
      
      // Add event listeners for request actions
      elements.friendRequestsList.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const username = btn.dataset.username;
          const action = btn.dataset.action;
          try {
            if (action === 'accept') {
              await window.launcher.acceptFriend(username);
              setStatus(`Accepted friend request from ${username}`, "success");
            } else if (action === 'decline') {
              await window.launcher.declineFriend(username);
              setStatus(`Declined friend request from ${username}`, "info");
            } else if (action === 'cancel') {
              await window.launcher.cancelFriend(username);
              setStatus(`Cancelled friend request to ${username}`, "info");
            }
            loadFriendsAndRequests();
          } catch (err) {
            setStatus(`Error: ${err.message}`, "error");
          }
        });
      });
    }

    // Display friends
    const friends = data.friends || [];
    const onlineFriends = friends.filter(f => f.status === 'online');
    
    if (onlineFriends.length === 0) {
      elements.friendsListOnline.innerHTML = '<div class="empty">No friends online</div>';
    } else {
      elements.friendsListOnline.innerHTML = onlineFriends.map(friend => renderFriendItem(friend)).join('');
      attachFriendEventListeners();
    }

    if (friends.length === 0) {
      elements.friendsListAll.innerHTML = '<div class="empty">No friends yet. Add friends to get started!</div>';
    } else {
      elements.friendsListAll.innerHTML = friends.map(friend => renderFriendItem(friend)).join('');
      attachFriendEventListeners();
    }
  } catch (err) {
    setStatus(`Error loading friends: ${err.message}`, "error");
    console.error("Failed to load friends:", err);
  }
};

const renderFriendItem = (friend) => {
  const avatar = friend.username.charAt(0).toUpperCase();
  const statusDot = friend.status === 'online' ? 'online' : '';
  return `
    <div class="friend-item">
      <div class="friend-info">
        <div class="friend-avatar">${avatar}</div>
        <div class="friend-details">
          <div class="friend-name">${friend.username}</div>
          <div class="friend-status">
            <span class="friend-status-dot ${statusDot}"></span>
            <span>${friend.status === 'online' ? 'Online' : 'Offline'}</span>
            ${friend.currentServer ? `<span class="friend-server">• ${friend.currentServer}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="friend-actions">
        <button class="friend-btn" data-username="${friend.username}" data-action="message">💬</button>
        <button class="friend-btn" data-username="${friend.username}" data-action="join">〰️ Join</button>
        <button class="friend-btn danger" data-username="${friend.username}" data-action="remove">✕</button>
      </div>
    </div>
  `;
};

const attachFriendEventListeners = () => {
  document.querySelectorAll('[data-action="remove"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.dataset.username;
      try {
        await window.launcher.removeFriend(username);
        setStatus(`Removed ${username} from friends`, "info");
        loadFriendsAndRequests();
      } catch (err) {
        setStatus(`Error: ${err.message}`, "error");
      }
    });
  });

  document.querySelectorAll('[data-action="message"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const username = btn.dataset.username;
      setStatus(`Message feature coming soon for ${username}`, "info");
    });
  });

  document.querySelectorAll('[data-action="join"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const username = btn.dataset.username;
      setStatus(`Join feature coming soon for ${username}`, "info");
    });
  });
};

// Event Listeners for Friends UI
// Add to init function:
/*
  if (elements.friendsBtn) {
    elements.friendsBtn.addEventListener("click", () => {
      switchView("friends");
      setStatus("Friends list loaded", "info");
      loadFriendsAndRequests();
    });
  }

  if (elements.addFriendBtn) {
    elements.addFriendBtn.addEventListener("click", () => {
      elements.friendUsernameInput.value = '';
      if (elements.addFriendError) {
        elements.addFriendError.classList.add('hidden');
      }
      elements.addFriendModal.classList.remove('hidden');
    });
  }

  if (elements.addFriendSubmit) {
    elements.addFriendSubmit.addEventListener("click", async () => {
      const username = elements.friendUsernameInput.value.trim();
      const currentUsername = state.user?.name || "";
      
      // Clear previous errors
      if (elements.addFriendError) {
        elements.addFriendError.classList.add('hidden');
        elements.addFriendError.textContent = '';
      }
      
      if (!username) {
        if (elements.addFriendError) {
          elements.addFriendError.textContent = "Please enter a username";
          elements.addFriendError.classList.remove('hidden');
        }
        setStatus("Please enter a username", "error");
        return;
      }
      
      // Frontend validation for self-friending
      if (username.toLowerCase() === currentUsername.toLowerCase()) {
        if (elements.addFriendError) {
          elements.addFriendError.textContent = "You cannot add yourself as a friend";
          elements.addFriendError.classList.remove('hidden');
        }
        setStatus("You cannot add yourself as a friend", "error");
        return;
      }
      
      try {
        await window.launcher.addFriend(username);
        setStatus(`Friend request sent to ${username}`, "success");
        elements.friendUsernameInput.value = '';
        elements.addFriendModal.classList.add('hidden');
        if (elements.addFriendError) {
          elements.addFriendError.classList.add('hidden');
        }
        loadFriendsAndRequests();
      } catch (err) {
        if (elements.addFriendError) {
          elements.addFriendError.textContent = err.message;
          elements.addFriendError.classList.remove('hidden');
        }
        setStatus(`Error: ${err.message}`, "error");
      }
    });
  }

  if (elements.addFriendCancel || elements.addFriendModalClose) {
    const closeModal = () => {
      elements.addFriendModal.classList.add('hidden');
    };
    if (elements.addFriendCancel) elements.addFriendCancel.addEventListener("click", closeModal);
    if (elements.addFriendModalClose) elements.addFriendModalClose.addEventListener("click", closeModal);
  }

  // Request type toggle
  const toggleIncoming = document.getElementById("toggle-incoming");
  const toggleOutgoing = document.getElementById("toggle-outgoing");
  
  if (toggleIncoming) {
    toggleIncoming.addEventListener("click", () => {
      state.currentRequestType = "incoming";
      toggleIncoming.classList.add('active');
      if (toggleOutgoing) toggleOutgoing.classList.remove('active');
      loadFriendsAndRequests();
    });
  }
  
  if (toggleOutgoing) {
    toggleOutgoing.addEventListener("click", () => {
      state.currentRequestType = "outgoing";
      toggleOutgoing.classList.add('active');
      if (toggleIncoming) toggleIncoming.classList.remove('active');
      loadFriendsAndRequests();
    });
  }
*/

// Debug function
window.debugSimulateIncomingRequest = async (username) => {
  try {
    await window.launcher.simulateIncomingRequest(username);
    console.log(`Simulated incoming friend request from ${username}`);
    if (state.currentView === "friends") {
      await loadFriendsAndRequests();
    }
  } catch (err) {
    console.error("Failed to simulate incoming request:", err);
  }
};
