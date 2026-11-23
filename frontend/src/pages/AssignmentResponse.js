import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api';

export default function AssignmentResponse() {
  const [searchParams] = useSearchParams();
  const action = searchParams.get('action');
  const token = searchParams.get('token') || '';
  const validAction = action === 'accept' || action === 'reject';
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await api.post('/assignments/respond', {
        token,
        action,
        ...(action === 'reject' ? { closingRemarks: remarks } : {})
      });
      setResult(response);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const heading = action === 'accept' ? 'Accept this assignment?' : 'Reject this assignment?';
  const description = action === 'accept'
    ? 'Accepting will move the assigned task or issue to In Progress.'
    : 'Please provide closing remarks explaining why you are rejecting this assignment.';

  return (
    <main style={{ minHeight:'100vh', background:'#0f1724', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <section style={{ width:'100%', maxWidth:480, background:'#fff', borderRadius:14, padding:32, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:24 }}>
          <img src="/zcs_logo.png" alt="TaskTracker logo" style={{ width:36, height:36, objectFit:'contain' }} />
          <span style={{ color:'#0f1724', fontWeight:700, fontSize:18 }}>TaskTracker</span>
        </div>
        {result ? (
          <>
            <h1 style={{ fontSize:20, margin:'0 0 8px', color:'#1a202c' }}>Response recorded</h1>
            <p style={{ fontSize:14, color:'#475569', margin:0 }}>{result.message}</p>
          </>
        ) : !validAction || !token ? (
          <>
            <h1 style={{ fontSize:20, margin:'0 0 8px', color:'#1a202c' }}>Invalid assignment link</h1>
            <p style={{ fontSize:14, color:'#475569', margin:0 }}>The email link is incomplete or invalid. Ask the project manager to send you a new assignment email.</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize:20, margin:'0 0 8px', color:'#1a202c' }}>{heading}</h1>
            <p style={{ fontSize:14, color:'#475569', margin:'0 0 20px' }}>{description}</p>
            <form onSubmit={submit}>
              {action === 'reject' && (
                <div style={{ marginBottom:18 }}>
                  <label htmlFor="closing-remarks" style={{ display:'block', fontSize:13, fontWeight:600, color:'#334155', marginBottom:6 }}>Closing remarks (required)</label>
                  <textarea
                    id="closing-remarks"
                    value={remarks}
                    onChange={event => setRemarks(event.target.value)}
                    required
                    maxLength={2000}
                    rows={5}
                    style={{ width:'100%', boxSizing:'border-box', border:'1px solid #cbd5e1', borderRadius:8, padding:10, fontSize:14, resize:'vertical' }}
                  />
                  <div style={{ textAlign:'right', color:'#94a3b8', fontSize:11 }}>{remarks.length}/2000</div>
                </div>
              )}
              {error && <p role="alert" style={{ color:'#b91c1c', fontSize:13, margin:'0 0 14px' }}>{error}</p>}
              <button
                type="submit"
                disabled={submitting || (action === 'reject' && !remarks.trim())}
                style={{
                  width:'100%', padding:12, border:0, borderRadius:8, color:'#fff', fontSize:14, fontWeight:600,
                  background:action === 'accept' ? '#1d9e75' : '#e24b4a',
                  opacity:submitting || (action === 'reject' && !remarks.trim()) ? 0.65 : 1,
                  cursor:submitting ? 'wait' : 'pointer'
                }}
              >
                {submitting ? 'Submitting...' : action === 'accept' ? 'Confirm acceptance' : 'Submit rejection'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
