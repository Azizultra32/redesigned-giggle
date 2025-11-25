import { useEffect, useState } from 'react';
import { wsClient, FeedInfo, TranscriptUpdate, AutopilotUpdate, TabInfo } from '../lib/websocket-client';

interface FeedState {
  A: FeedInfo;
  B: FeedInfo;
  C: FeedInfo;
  D: FeedInfo;
  E: FeedInfo;
}

interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: string;
}

export default function Dashboard() {
  const [isConnected, setIsConnected] = useState(false);
  const [feeds, setFeeds] = useState<FeedState>({
    A: { id: 'A', label: 'Deepgram', status: 'disconnected', lastUpdate: '' },
    B: { id: 'B', label: 'Voice Concierge', status: 'disconnected', lastUpdate: '' },
    C: { id: 'C', label: 'Emergency', status: 'disconnected', lastUpdate: '' },
    D: { id: 'D', label: 'Summary', status: 'disconnected', lastUpdate: '' },
    E: { id: 'E', label: 'Compliance', status: 'disconnected', lastUpdate: '' },
  });
  const [transcripts, setTranscripts] = useState<TranscriptUpdate[]>([]);
  const [autopilot, setAutopilot] = useState<AutopilotUpdate | null>(null);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    // Setup event handlers
    const unsubConnection = wsClient.on('connection', ({ connected }) => {
      setIsConnected(connected);
    });

    const unsubFeedStatus = wsClient.on('feed_status', (feed: FeedInfo) => {
      setFeeds(prev => ({
        ...prev,
        [feed.id]: { ...feed, lastUpdate: new Date().toISOString() }
      }));
    });

    const unsubTranscript = wsClient.on('transcript', (data: TranscriptUpdate) => {
      setTranscripts(prev => {
        const updated = [...prev, data].slice(-50); // Keep last 50
        return updated;
      });
    });

    const unsubAutopilot = wsClient.on('autopilot', (data: AutopilotUpdate) => {
      setAutopilot(data);
    });

    const unsubAlert = wsClient.on('alert', (data: Alert) => {
      setAlerts(prev => [{ ...data, id: Date.now().toString() }, ...prev].slice(0, 20));
    });

    const unsubActiveTab = wsClient.on('active_tab', (data: any) => {
      // Update tabs list
      if (data.tabId) {
        setTabs(prev => prev.map(t => ({
          ...t,
          isActive: t.tabId === data.tabId
        })));
      }
    });

    // Connect to WebSocket
    wsClient.connect();

    // Fetch initial tabs from API
    fetchTabs();

    // Heartbeat
    const heartbeat = setInterval(() => {
      if (wsClient.getIsConnected()) {
        wsClient.ping();
      }
    }, 30000);

    return () => {
      unsubConnection();
      unsubFeedStatus();
      unsubTranscript();
      unsubAutopilot();
      unsubAlert();
      unsubActiveTab();
      clearInterval(heartbeat);
      wsClient.disconnect();
    };
  }, []);

  const fetchTabs = async () => {
    try {
      const res = await fetch('http://localhost:3001/tabs');
      const data = await res.json();
      setTabs(data.tabs || []);
    } catch (error) {
      console.error('Failed to fetch tabs:', error);
    }
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1 className="dashboard-title">GHOST CONTROL CENTER</h1>
        <div className="connection-status">
          <span className={`status-dot ${isConnected ? 'connected' : ''}`} />
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      <main className="dashboard-content">
        {/* Feed A: Deepgram Transcript */}
        <div className="feed-tile">
          <div className="feed-header">
            <span className="feed-label">Feed A: Transcript</span>
            <span className={`feed-indicator ${feeds.A.status}`} />
          </div>
          <div className="feed-content">
            {transcripts.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: '13px' }}>No transcripts yet...</p>
            ) : (
              transcripts.map((t, i) => (
                <div key={i} className={`transcript-line ${t.isFinal ? '' : 'interim'}`}>
                  <div className="transcript-speaker">
                    Speaker {t.speaker}
                    <span className="transcript-time">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  {t.text}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Autopilot Status */}
        <div className="feed-tile">
          <div className="feed-header">
            <span className="feed-label">Feed D: Autopilot</span>
            <span className={`feed-indicator ${autopilot ? 'connected' : 'disconnected'}`} />
          </div>
          <div className="feed-content">
            <div className={`autopilot-score ${autopilot?.status || 'red'}`}>
              {autopilot?.score || 0}%
            </div>
            <h4 style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
              SUGGESTIONS
            </h4>
            <ul className="suggestions-list">
              {(autopilot?.suggestions || ['No suggestions yet']).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Connected Tabs */}
        <div className="feed-tile">
          <div className="feed-header">
            <span className="feed-label">Connected Tabs ({tabs.length})</span>
            <button
              onClick={fetchTabs}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Refresh
            </button>
          </div>
          <div className="feed-content">
            {tabs.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: '13px' }}>No tabs connected...</p>
            ) : (
              <ul className="tabs-list">
                {tabs.map(tab => (
                  <li key={tab.tabId} className={`tab-item ${tab.isActive ? 'active' : ''}`}>
                    <div className="tab-info">
                      <div className="tab-title">{tab.title || 'Untitled'}</div>
                      <div className="tab-url">{tab.url}</div>
                      {tab.patientHint && (
                        <div className="tab-patient">
                          Patient: {tab.patientHint.name || tab.patientHint.mrn || 'Unknown'}
                        </div>
                      )}
                    </div>
                    {tab.isActive && (
                      <span style={{ color: '#dc2626', fontSize: '11px', fontWeight: 600 }}>
                        ACTIVE
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Alerts (Feed C) */}
        <div className="feed-tile">
          <div className="feed-header">
            <span className="feed-label">Feed C: Alerts</span>
            <span className={`feed-indicator ${feeds.C.status}`} />
          </div>
          <div className="feed-content">
            {alerts.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: '13px' }}>No alerts...</p>
            ) : (
              alerts.map(alert => (
                <div key={alert.id} className={`alert-item ${alert.severity}`}>
                  <strong>{alert.severity.toUpperCase()}</strong>: {alert.message}
                  <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '4px' }}>
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Feed Status Overview */}
        <div className="feed-tile">
          <div className="feed-header">
            <span className="feed-label">Feed Status</span>
          </div>
          <div className="feed-content">
            {Object.values(feeds).map(feed => (
              <div
                key={feed.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px',
                  borderBottom: '1px solid #2d2d44'
                }}
              >
                <span>Feed {feed.id}: {feed.label}</span>
                <span className={`feed-indicator ${feed.status}`} />
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="feed-tile">
          <div className="feed-header">
            <span className="feed-label">Quick Actions</span>
          </div>
          <div className="feed-content">
            <div className="actions-grid">
              <button className="action-btn" onClick={() => wsClient.send({ type: 'command', action: 'map' })}>
                <span className="action-icon">🎯</span>
                Map Fields
              </button>
              <button className="action-btn" onClick={() => wsClient.send({ type: 'command', action: 'fill' })}>
                <span className="action-icon">✍️</span>
                Smart Fill
              </button>
              <button className="action-btn" onClick={() => wsClient.send({ type: 'command', action: 'undo' })}>
                <span className="action-icon">↩️</span>
                Undo
              </button>
              <button className="action-btn" onClick={fetchTabs}>
                <span className="action-icon">🔄</span>
                Refresh Tabs
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
