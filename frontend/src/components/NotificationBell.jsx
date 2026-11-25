import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';

const notificationIcon = (type = '') => {
  if (type.includes('assigned')) return 'ti-user-plus';
  if (type.includes('blocked')) return 'ti-hand-stop';
  if (type.includes('reject')) return 'ti-circle-x';
  if (type.includes('comment')) return 'ti-message';
  if (type.includes('project')) return 'ti-folder';
  return 'ti-bell';
};

function NotificationSkeleton() {
  return (
    <div className="notification-skeleton" aria-label="Loading notifications">
      {[0, 1, 2].map((item) => <div key={item} className="notification-skeleton-row" />)}
    </div>
  );
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const bellRef = useRef(null);
  const openRef = useRef(false);
  const filterRef = useRef('all');
  const knownIdsRef = useRef(new Set());
  const initializedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  openRef.current = open;
  filterRef.current = filter;

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get('/notifications', { page: 1, limit: 20, filter });
      setItems(result.items || []);
      setUnreadCount(Number(result.unreadCount) || 0);
    } catch (requestError) {
      setError(requestError.message || 'Unable to load notifications');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (open) {
      void loadItems();
      panelRef.current?.focus();
    }
  }, [open, loadItems]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const result = await api.get('/notifications', {
          page: 1,
          limit: openRef.current ? 20 : 5,
          filter: 'all'
        });
        if (!active) return;
        const latest = result.items || [];
        setUnreadCount(Number(result.unreadCount) || 0);
        const latestIds = new Set(latest.map((item) => item.id || item._id));
        if (initializedRef.current) {
          const newlyReceived = latest.find((item) => !knownIdsRef.current.has(item.id || item._id));
          if (newlyReceived) {
            toast(`New notification: ${newlyReceived.title}`);
          }
        } else {
          initializedRef.current = true;
        }
        latestIds.forEach((id) => knownIdsRef.current.add(id));
        if (openRef.current) {
          const visibleItems = filterRef.current === 'unread'
            ? latest.filter((item) => !item.isRead)
            : latest;
          setItems(visibleItems);
          setError('');
        }
      } catch (requestError) {
        if (active && openRef.current) setError(requestError.message || 'Unable to refresh notifications');
      }
    };
    void poll();
    const timer = window.setInterval(poll, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        bellRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll('button:not(:disabled), [href], [tabindex="0"]');
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const markRead = async (item) => {
    if (item.isRead) return;
    const previousItems = items;
    const previousCount = unreadCount;
    const itemId = item.id || item._id;
    setItems((current) => filter === 'unread'
      ? current.filter((entry) => (entry.id || entry._id) !== itemId)
      : current.map((entry) => (
        (entry.id || entry._id) === itemId ? { ...entry, isRead: true } : entry
      )));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await api.patch(`/notifications/${encodeURIComponent(itemId)}/read`);
    } catch (requestError) {
      setItems(previousItems);
      setUnreadCount(previousCount);
      toast.error(requestError.message || 'Unable to mark notification as read');
    }
  };

  const openItem = (item) => {
    void markRead(item);
    if (item.link) navigate(item.link);
    setOpen(false);
  };

  const deleteItem = async (event, item) => {
    event.stopPropagation();
    const previousItems = items;
    const previousCount = unreadCount;
    const itemId = item.id || item._id;
    setItems((current) => current.filter((entry) => (entry.id || entry._id) !== itemId));
    if (!item.isRead) setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await api.delete(`/notifications/${encodeURIComponent(itemId)}`);
      setActionError('');
    } catch (requestError) {
      setItems(previousItems);
      setUnreadCount(previousCount);
      setActionError(requestError.message || 'Unable to delete notification');
    }
  };

  const markAllRead = async () => {
    const previousItems = items;
    const previousCount = unreadCount;
    setItems(filter === 'unread'
      ? []
      : items.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
    try {
      await api.patch('/notifications/read-all');
      setActionError('');
    } catch (requestError) {
      setItems(previousItems);
      setUnreadCount(previousCount);
      setActionError(requestError.message || 'Unable to mark notifications as read');
    }
  };

  const clearRead = async () => {
    if (!window.confirm('Delete all read notifications? Unread notifications will be kept.')) return;
    const previousItems = items;
    setItems((current) => current.filter((item) => !item.isRead));
    try {
      await api.delete('/notifications/clear-read');
      setActionError('');
    } catch (requestError) {
      setItems(previousItems);
      setActionError(requestError.message || 'Unable to clear read notifications');
    }
  };

  return (
    <div className="notification-bell-root" ref={rootRef}>
      <button
        ref={bellRef}
        type="button"
        className="notification-bell-button"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <i className="ti ti-bell" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <section
          ref={panelRef}
          className="notification-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          tabIndex={-1}
        >
          <header className="notification-panel-header">
            <div>
              <h2>Notifications</h2>
              <span>{unreadCount} unread</span>
            </div>
            <div className="notification-panel-actions">
              <button type="button" onClick={markAllRead} disabled={!unreadCount}>Mark all as read</button>
              <button type="button" onClick={clearRead}>Clear read</button>
            </div>
          </header>
          <div className="notification-tabs" role="tablist" aria-label="Notification filter">
            {['all', 'unread'].map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                className={filter === value ? 'active' : ''}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : 'Unread'}
              </button>
            ))}
          </div>
          {actionError && <p className="notification-error" role="alert">{actionError}</p>}
          <div className="notification-list" aria-live="polite">
            {loading ? <NotificationSkeleton /> : error ? (
              <div className="notification-state">
                <p role="alert">{error}</p>
                <button type="button" onClick={loadItems}>Retry</button>
              </div>
            ) : items.length ? items.map((item) => {
              const itemId = item.id || item._id;
              const timeLabel = formatDistanceToNow(new Date(item.createdAt), { addSuffix: true });
              return (
                <div key={itemId} className={`notification-item${item.isRead ? '' : ' unread'}`}>
                  <button type="button" className="notification-item-open" onClick={() => openItem(item)}>
                    <span className="notification-type-icon"><i className={`ti ${notificationIcon(item.type)}`} aria-hidden="true" /></span>
                    <span className="notification-item-content">
                      <strong>{item.title}</strong>
                      <span>{item.message}</span>
                      <time dateTime={item.createdAt}>{timeLabel}</time>
                    </span>
                    {!item.isRead && <span className="notification-unread-dot" aria-label="Unread" />}
                  </button>
                  <button
                    type="button"
                    className="notification-delete"
                    aria-label={`Delete ${item.title}`}
                    title="Delete notification"
                    onClick={(event) => { void deleteItem(event, item); }}
                  >
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </div>
              );
            }) : (
              <div className="notification-state">You're all caught up</div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
