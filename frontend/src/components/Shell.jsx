import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Plus } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { api } from '../api.js';
import { ROLE_LABEL, dateTime } from '../format.js';

const NAV = [
  { to: '/requests', label: 'Requests' },
  { to: '/vendors', label: 'Vendors', roles: ['procurement', 'finance', 'admin'] },
  { to: '/audit', label: 'Audit log', roles: ['finance', 'admin'] },
  { to: '/admin', label: 'Users', roles: ['admin'] },
];

export default function Shell() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [feed, setFeed] = useState({ notifications: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const knownIds = useRef(null);
  const bellRef = useRef(null);

  // Polls for updates and raises a toast for each notification that is new since the last poll.
  const poll = useCallback(async () => {
    try {
      const data = await api.get('/notifications');
      if (knownIds.current) {
        data.notifications
          .filter((n) => !n.read_at && !knownIds.current.has(n.id))
          .slice(0, 3)
          .forEach((n) => toast.push(n.title, 'info'));
      }
      knownIds.current = new Set(data.notifications.map((n) => n.id));
      setFeed(data);
    } catch {
      // Keep the last known state when offline.
    }
  }, [toast]);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, 15000);
    return () => clearInterval(timer);
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const openNotification = (n) => {
    if (!n.read_at) api.post(`/notifications/${n.id}/read`).catch(() => {});
    setOpen(false);
    if (n.request_id) navigate(`/requests/${n.request_id}`);
    poll();
  };

  const markAllRead = async () => {
    await api.post('/notifications/read-all').catch(() => {});
    poll();
  };

  const links = NAV.filter((l) => !l.roles || l.roles.includes(user.role));
  const canCreate = ['requester', 'manager'].includes(user.role);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Requisitions</div>
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-end">
          {canCreate && (
            <button className="btn btn-primary" onClick={() => navigate('/requests/new')}>
              <Plus size={16} aria-hidden="true" /> New request
            </button>
          )}
          <div className="bell-wrap" ref={bellRef}>
            <button
              className="icon-btn"
              aria-label={`Notifications, ${feed.unread} unread`}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <Bell size={18} />
              {feed.unread > 0 && <span className="badge">{feed.unread}</span>}
            </button>
            {open && (
              <div className="popover" role="dialog" aria-label="Notifications">
                <div className="popover-head">
                  <strong>Notifications</strong>
                  {feed.unread > 0 && (
                    <button className="link" onClick={markAllRead}>
                      Mark all read
                    </button>
                  )}
                </div>
                {feed.notifications.length === 0 ? (
                  <p className="muted pad">Updates on your requests will appear here.</p>
                ) : (
                  <ul className="notif-list">
                    {feed.notifications.map((n) => (
                      <li key={n.id}>
                        <button className={`notif${n.read_at ? '' : ' is-unread'}`} onClick={() => openNotification(n)}>
                          <span className="notif-title">{n.title}</span>
                          <span className="notif-msg">{n.message}</span>
                          <span className="notif-time">{dateTime(n.created_at)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="who">
            <span className="who-name">{user.name}</span>
            <span className="who-role">{ROLE_LABEL[user.role]}</span>
          </div>
          <button
            className="icon-btn"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
