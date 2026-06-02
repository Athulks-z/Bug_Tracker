import { useState } from 'react';

const STATUSES = ['To do', 'In progress', 'Blocked', 'Completed'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

export default function TaskModal({ task, projects, users, onSave, onClose }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    project: task?.project?._id || task?.project || '',
    assignee: task?.assignee?._id || task?.assignee || '',
    status: task?.status || 'To do',
    priority: task?.priority || 'Medium',
    startDate: task?.startDate ? task.startDate.slice(0, 10) : '',
    endDate: task?.endDate ? task.endDate.slice(0, 10) : ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.project) {
      setError('Title and project are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (!payload.assignee) delete payload.assignee;
      if (!payload.startDate) delete payload.startDate;
      if (!payload.endDate) delete payload.endDate;
      await onSave(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 13,
    color: '#1a202c',
    outline: 'none',
    background: '#fff'
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 14,
          padding: 28,
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a202c' }}>
            {task ? 'Edit Task' : 'New Task'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8' }}>
            <i className="ti ti-x" />
          </button>
        </div>

        {error && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 14,
            fontSize: 13
          }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
            Title *
          </label>
          <input
            style={inputStyle}
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="Task title"
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
            Description
          </label>
          <textarea
            style={{ ...inputStyle, height: 80, resize: 'vertical' }}
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Task details..."
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              Project *
            </label>
            <select
              style={inputStyle}
              value={form.project}
              onChange={e => setForm({ ...form, project: e.target.value })}
            >
              <option value="">Select project</option>
              {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              Assignee
            </label>
            <select
              style={inputStyle}
              value={form.assignee}
              onChange={e => setForm({ ...form, assignee: e.target.value })}
            >
              <option value="">Unassigned</option>
              {users.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              Status
            </label>
            <select
              style={inputStyle}
              value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value })}
            >
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              Priority
            </label>
            <select
              style={inputStyle}
              value={form.priority}
              onChange={e => setForm({ ...form, priority: e.target.value })}
            >
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              Start Date
            </label>
            <input
              type="date"
              style={inputStyle}
              value={form.startDate}
              onChange={e => setForm({ ...form, startDate: e.target.value })}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              End Date
            </label>
            <input
              type="date"
              style={inputStyle}
              value={form.endDate}
              onChange={e => setForm({ ...form, endDate: e.target.value })}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 18px',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              background: 'none',
              fontSize: 13,
              color: '#64748b'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              padding: '9px 18px',
              background: '#378add',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              opacity: saving ? 0.7 : 1
            }}
          >
            {saving ? 'Saving...' : task ? 'Update Task' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}