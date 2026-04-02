import { useState, useEffect, useRef } from 'react';
import { Settings, Plus, Play, LayoutDashboard, Briefcase, Users, HelpCircle, X, AlertTriangle, Key, Trash2, Database, Info, ShieldCheck, CheckCircle2, Circle, Zap, Upload, FileText, UserCheck, Star, Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { analyzeCandidates } from './lib/analyzer';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000/api';

function App() {
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [jobRequirements, setJobRequirements] = useState('');

  // Candidates Data
  const [dbCandidates, setDbCandidates] = useState([]);
  const [selectedDbIds, setSelectedDbIds] = useState(new Set());
  
  // App State
  const [resultsMap, setResultsMap] = useState({}); // mapped by candidate ID
  const [activeCandidateId, setActiveCandidateId] = useState(null);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isFetchingDb, setIsFetchingDb] = useState(false);
  
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [activeNav, setActiveNav] = useState('candidates');
  const [showHelp, setShowHelp] = useState(false);
  // candidateTab removed — now separate nav items
  
  // Manual Mode State
  const [manualEntries, setManualEntries] = useState([{ id: Date.now(), name: '', file: null, text: '', status: 'idle' }]);
  const [manualResultsMap, setManualResultsMap] = useState({});
  const [manualJobReq, setManualJobReq] = useState('');
  const [activeManualId, setActiveManualId] = useState(null);
  
  // API Usage
  const [apiUsage, setApiUsage] = useState(null);
  const [isCheckingUsage, setIsCheckingUsage] = useState(false);
  
  // Self-Analysis (My Resume)
  const [selfFile, setSelfFile] = useState(null);
  const [selfJobDesc, setSelfJobDesc] = useState('');
  const [selfCgpa, setSelfCgpa] = useState('');
  const [selfResult, setSelfResult] = useState(null);
  const [isSelfAnalyzing, setIsSelfAnalyzing] = useState(false);
  const selfFileRef = useRef(null);
  
  // Candidate filtering
  const [topNFilter, setTopNFilter] = useState('all');

  const fileInputRef = useRef(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    const key = localStorage.getItem('gemini_api_key');
    if (key) setApiKey(key);
    fetchDbCandidates();
  }, []);

  // Fetch from MongoDB
  const fetchDbCandidates = async () => {
    setIsFetchingDb(true);
    try {
      const res = await fetch(`${API_BASE}/candidates`);
      const data = await res.json();
      if (data.success) {
        setDbCandidates(data.candidates);
        // By default, select all new ones if we had none selected
        setSelectedDbIds(new Set(data.candidates.map(c => c._id)));
      }
    } catch (err) {
      console.error('Failed to fetch DB', err);
      setError('Could not connect to Database. Is the server running?');
    } finally {
      setIsFetchingDb(false);
    }
  };

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true);
    setError('');
    const formData = new FormData();
    for (const file of files) formData.append('resumes', file);
    try {
      const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(data.message);
        setTimeout(() => setSuccessMsg(''), 3000);
        fetchDbCandidates();
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch (err) {
      setError('Failed to connect to backend.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/candidates/${id}`, { method: 'DELETE' });
      setDbCandidates(dbCandidates.filter(c => c._id !== id));
      setSelectedDbIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      if (activeCandidateId === id) setActiveCandidateId(null);
    } catch(err) {
      console.error(err);
    }
  };

  const toggleSelection = (id, e) => {
    e.stopPropagation();
    setSelectedDbIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAnalyze = async () => {
    if (!apiKey) { setShowSettings(true); setError('Gemini API Key required.'); return; }
    if (selectedDbIds.size === 0) { setError('Select at least one candidate first.'); return; }

    setError('');
    setIsAnalyzing(true);
    
    abortControllerRef.current = new AbortController();

    try {
      const candidatesToAnalyze = dbCandidates
        .filter(c => selectedDbIds.has(c._id))
        .map(c => ({ id: c._id, name: c.name, text: c.resumeText }));

      const resList = await analyzeCandidates(candidatesToAnalyze, jobRequirements, apiKey, null, abortControllerRef.current.signal);
      
      const newMap = { ...resultsMap };
      resList.forEach(res => {
        newMap[res.originalId] = res;
      });
      setResultsMap(newMap);

      if (resList.length > 0) setActiveCandidateId(resList[0].originalId);
    } catch (err) {
      if (err.name === 'AbortError' || (err.message && err.message.includes('cancelled'))) {
        setError('Analysis cancelled.');
      } else {
        setError(err.message || 'Analysis failed.');
      }
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };
  
  const handleCancelAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleManualAnalyze = async () => {
    if (!apiKey) { setShowSettings(true); setError('Gemini API Key required.'); return; }
    
    const validEntries = manualEntries.filter(e => e.name && e.file);
    if (validEntries.length === 0) { setError('Add at least one candidate with a name and PDF resume.'); return; }

    setError('');
    setIsAnalyzing(true);
    abortControllerRef.current = new AbortController();

    try {
      const candidatesToAnalyze = [];
      for (const entry of validEntries) {
        if (!entry.text) {
          const formData = new FormData();
          formData.append('resume', entry.file);
          
          const res = await fetch(`${API_BASE}/extract`, { method: 'POST', body: formData, signal: abortControllerRef.current.signal });
          if (!res.ok) throw new Error('Failed to connect for text extraction.');
          const data = await res.json();
          if (data.success) {
            candidatesToAnalyze.push({ id: entry.id, name: entry.name, text: data.text });
            
            setManualEntries(prev => prev.map(p => p.id === entry.id ? { ...p, text: data.text } : p));
          } else {
             throw new Error(data.error || 'Text extraction failed');
          }
        } else {
           candidatesToAnalyze.push({ id: entry.id, name: entry.name, text: entry.text });
        }
      }

      const resList = await analyzeCandidates(candidatesToAnalyze, manualJobReq, apiKey, null, abortControllerRef.current.signal);
      
      const newMap = { ...manualResultsMap };
      resList.forEach(res => {
        newMap[res.originalId] = res;
      });
      setManualResultsMap(newMap);
      if (resList.length > 0) setActiveManualId(resList[0].originalId);
      
      setSuccessMsg(`Manual analysis complete for ${resList.length} candidates!`);
      setTimeout(() => setSuccessMsg(''), 3000);

    } catch (err) {
      if (err.name === 'AbortError' || (err.message && err.message.includes('cancelled'))) {
        setError('Analysis cancelled.');
      } else {
        setError(err.message || 'Analysis failed.');
      }
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  const checkApiUsage = async (keyToCheck) => {
    const key = keyToCheck || apiKey;
    if (!key) return;
    setIsCheckingUsage(true);
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with only: OK' }] }], generationConfig: { temperature: 0, maxOutputTokens: 5 } })
      });
      if (res.ok) {
        setApiUsage({ status: 'active', message: 'API Key is valid & working' });
      } else if (res.status === 429) {
        setApiUsage({ status: 'rate_limited', message: 'Rate limited — wait 60s and try again' });
      } else if (res.status === 400 || res.status === 403) {
        setApiUsage({ status: 'invalid', message: 'Invalid API Key' });
      } else {
        setApiUsage({ status: 'error', message: `Error: ${res.status} ${res.statusText}` });
      }
    } catch (err) {
      setApiUsage({ status: 'error', message: 'Network error — could not reach Gemini API' });
    } finally {
      setIsCheckingUsage(false);
    }
  };

  const handleSelfAnalyze = async () => {
    if (!apiKey) { setShowSettings(true); setError('API Key required.'); return; }
    if (!selfFile) { setError('Please upload your resume PDF.'); return; }
    if (!selfJobDesc.trim()) { setError('Please enter the job description you are applying for.'); return; }
    
    setIsSelfAnalyzing(true); setError(''); setSelfResult(null);
    try {
      const formData = new FormData();
      formData.append('resume', selfFile);
      const extractRes = await fetch(`${API_BASE}/extract`, { method: 'POST', body: formData });
      if (!extractRes.ok) throw new Error('Failed to extract PDF text');
      const { text: resumeText } = await extractRes.json();
      
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
      const prompt = `You are an expert career coach and resume analyst. A candidate is preparing to apply for a job. Analyze their resume against the target role and give detailed, actionable feedback.

TARGET JOB DESCRIPTION:
${selfJobDesc}

${selfCgpa ? `CANDIDATE'S CGPA: ${selfCgpa}` : ''}

CANDIDATE'S RESUME:
${resumeText}

Return EXACTLY a JSON object with this schema:
{
  "overallScore": <0-100 integer>,
  "verdict": "<One line: e.g. Strong Match, Moderate Fit, Needs Improvement>",
  "summary": "<3-4 sentence detailed analysis of how well the resume matches the job>",
  "strengths": ["<strength1>", "<strength2>", "<strength3>"],
  "weaknesses": ["<weakness1>", "<weakness2>", "<weakness3>"],
  "improvements": ["<specific actionable improvement 1>", "<improvement 2>", "<improvement 3>", "<improvement 4>", "<improvement 5>"],
  "missingSkills": ["<skill the job needs but resume lacks>"],
  "keySkillsMatch": [{"skill": "<skill name>", "resumeLevel": "<Strong|Moderate|Weak|Missing>", "importance": "<Critical|Important|Nice-to-have>"}],
  "resumeTips": ["<formatting/content tip 1>", "<tip 2>", "<tip 3>"],
  "estimatedInterviewChance": "<High|Medium|Low>",
  "competencyMap": {"systemDesign": <0-100>, "leadership": <0-100>, "uxResearch": <0-100>, "visual": <0-100>, "engineering": <0-100>}
}`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } })
      });
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      let contentText = data.candidates[0].content.parts[0].text;
      contentText = contentText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      setSelfResult(JSON.parse(contentText));
      setSuccessMsg('Self-analysis complete!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setError(err.message || 'Self-analysis failed.');
    } finally {
      setIsSelfAnalyzing(false);
    }
  };

  const CircularScore = ({ score }) => {
    const radius = 50;
    const circ = 2 * Math.PI * radius;
    const val = (score / 100) * circ;
    return (
      <div className="fit-score-large" style={{ width: 120, height: 120 }}>
        <svg className="score-svg" viewBox="0 0 120 120">
          <circle className="score-circle-bg" cx="60" cy="60" r={radius} style={{ strokeWidth: 6 }} />
          <motion.circle 
            className="score-circle-val" 
            cx="60" cy="60" r={radius} 
            style={{ strokeWidth: 6 }}
            initial={{ strokeDasharray: `0 ${circ}` }}
            animate={{ strokeDasharray: `${val} ${circ}` }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        <div className="score-text">
          <span className="val" style={{ fontSize: '1.5rem' }}>{score}%</span>
          <span className="lbl">Fit Score</span>
        </div>
      </div>
    );
  };

  const RadarChart = ({ data }) => {
    const s = val => (val || 50);
    const cx = 120, cy = 120, r = 80;
    const angles = [-90, -18, 54, 126, 198].map(a => a * Math.PI / 180);
    const values = [s(data?.systemDesign), s(data?.leadership), s(data?.uxResearch), s(data?.visual), s(data?.engineering)];
    const labels = ['System Design', 'Leadership', 'Frontend', 'Backend', 'DevOps'];
    const getP = (val, i) => ({ x: cx + (val/100) * r * Math.cos(angles[i]), y: cy + (val/100) * r * Math.sin(angles[i]) });
    const outerPts = angles.map((a, i) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`).join(' ');
    const innerPts = angles.map((a) => `${cx + r*0.5 * Math.cos(a)},${cy + r*0.5 * Math.sin(a)}`).join(' ');
    const dataPts = values.map((v, i) => { const p = getP(v, i); return `${p.x},${p.y}`; }).join(' ');
    const labelPositions = angles.map((a, i) => ({ x: cx + (r + 18) * Math.cos(a), y: cy + (r + 18) * Math.sin(a), anchor: Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end' }));
    return (
      <div className="radar-chart">
        <svg viewBox="0 0 240 240" width="100%" height="100%">
          <polygon points={outerPts} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          <polygon points={innerPts} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          {angles.map((a, i) => <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="rgba(255,255,255,0.05)" />)}
          <polygon points={dataPts} fill="rgba(168, 85, 247, 0.35)" stroke="var(--color-primary)" strokeWidth="2" />
          {values.map((v, i) => { const p = getP(v, i); return <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--color-primary)" />; })}
          {labels.map((label, i) => <text key={i} x={labelPositions[i].x} y={labelPositions[i].y + 3} textAnchor={labelPositions[i].anchor} fill="var(--color-text-muted)" fontSize="8" fontWeight="600">{label}</text>)}
        </svg>
      </div>
    );
  };

  // Sort candidates: analyzed ones first (by score), then unanalyzed ones
  const displayList = [...dbCandidates].sort((a, b) => {
    const resA = resultsMap[a._id];
    const resB = resultsMap[b._id];
    if (resA && resB) return resB.score - resA.score;
    if (resA) return -1;
    if (resB) return 1;
    return 0;
  });

  const activeCandidateData = dbCandidates.find(c => c._id === activeCandidateId);
  const activeResult = resultsMap[activeCandidateId];

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo"><Database size={24} color="var(--color-primary)" /> ResumeSorter</div>
        <nav className="nav-group">
          <button className={`nav-item ${activeNav === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveNav('dashboard')}><LayoutDashboard size={20} /> Dashboard</button>
          <button className={`nav-item ${activeNav === 'candidates' ? 'active' : ''}`} onClick={() => setActiveNav('candidates')}><Users size={20} /> Candidates</button>
          <button className={`nav-item ${activeNav === 'manual' ? 'active' : ''}`} onClick={() => setActiveNav('manual')}><FileText size={20} /> Manual</button>
          <button className={`nav-item ${activeNav === 'myresume' ? 'active' : ''}`} onClick={() => setActiveNav('myresume')}><UserCheck size={20} /> My Resume</button>
          <button className={`nav-item ${activeNav === 'settings' ? 'active' : ''}`} onClick={() => setShowSettings(true)}><Settings size={20} /> Settings</button>
        </nav>
        
        {/* Run Analysis - right after nav */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button className="nav-item" onClick={handleAnalyze} disabled={isAnalyzing} style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(124,58,237,0.1))', color: 'var(--color-text)', border: '1px solid rgba(168,85,247,0.3)' }}>
            <Play size={20} fill={isAnalyzing ? 'currentColor' : 'none'} style={{ color: 'var(--color-primary)' }} />
            {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
          </button>
          {isAnalyzing && (
            <button onClick={handleCancelAnalysis} style={{ background: 'var(--color-danger)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', padding: '0.5rem', cursor: 'pointer', fontWeight: 'bold', textAlign: 'center' }}>Stop</button>
          )}
        </div>
        
        <div className="nav-group" style={{ marginTop: 'auto' }}>
          <button className="nav-item" onClick={() => setShowHelp(true)}><HelpCircle size={20} /> Help</button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content" style={(activeNav === 'dashboard' || activeNav === 'myresume') ? { display: 'block', overflowY: 'auto', padding: '3rem' } : {}}>
        
        {activeNav === 'dashboard' ? (() => {
           const allResults = { ...resultsMap, ...manualResultsMap };
           const allResultsList = Object.values(allResults);
           const analyzedCount = allResultsList.length;
           const avgScore = analyzedCount > 0 ? Math.round(allResultsList.reduce((acc, r) => acc + r.score, 0) / analyzedCount) : 0;
           
           return (
           <div style={{ maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
              <div className="flex-row justify-between items-center" style={{ marginBottom: '3rem' }}>
                <div>
                  <h1 style={{ fontSize: '2.8rem', fontWeight: 800, background: 'linear-gradient(to right, #fff, var(--color-primary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Talent Intelligence</h1>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '1.1rem', marginTop: '0.2rem' }}>Overview of your database and recent AI insights.</p>
                </div>
                <div className="flex-row gap-2" style={{ background: 'rgba(168, 85, 247, 0.1)', color: 'var(--color-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', fontWeight: 'bold', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
                  <Database size={20} /> {dbCandidates.length} Candidates Database
                </div>
              </div>

              {/* Top Metrics Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                 <div style={{ background: 'var(--color-surface)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: '-20px', right: '-20px', opacity: 0.05 }}><Users size={120} /></div>
                    <span style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '0.85rem', fontWeight: 600 }}>Total Profiles In Pipeline</span>
                    <div className="flex-row items-center gap-4">
                      <span style={{ fontSize: '3.5rem', fontWeight: 800, lineHeight: '1' }}>{dbCandidates.length}</span>
                      <span style={{ display: 'flex', alignItems: 'center', color: 'var(--color-success)', fontSize: '0.85rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>Active</span>
                    </div>
                 </div>
                 
                 <div style={{ background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(26, 23, 46, 1) 100%)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-primary)', position: 'relative', overflow: 'hidden', boxShadow: '0 10px 30px rgba(168,85,247,0.1)' }}>
                    <div style={{ position: 'absolute', top: 0, right: 0, width: '150px', height: '150px', background: 'var(--color-primary)', filter: 'blur(80px)', opacity: 0.2, borderRadius: '50%' }}></div>
                    <span style={{ display: 'block', color: 'var(--color-primary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '0.85rem', fontWeight: 600 }}>Successfully AI Analyzed</span>
                    <div className="flex-row items-center gap-4">
                      <span style={{ fontSize: '3.5rem', fontWeight: 800, lineHeight: '1', color: 'var(--color-text)' }}>{analyzedCount}</span>
                      {Object.keys(manualResultsMap).length > 0 && <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', background: 'var(--color-surface)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>{Object.keys(resultsMap).length} DB + {Object.keys(manualResultsMap).length} Manual</span>}
                    </div>
                 </div>
                 
                 <div style={{ background: 'var(--color-surface)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', position: 'relative', overflow: 'hidden' }}>
                    <span style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '0.85rem', fontWeight: 600 }}>Average Pipeline Fit</span>
                    <div className="flex-row items-center gap-4">
                      <span style={{ fontSize: '3.5rem', fontWeight: 800, lineHeight: '1', color: analyzedCount > 0 ? 'var(--color-success)' : 'inherit' }}>
                        {analyzedCount > 0 ? avgScore + '%' : '--'}
                      </span>
                    </div>
                 </div>
              </div>
              {/* How It Works */}
              <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>How It Works</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem', marginBottom: '3rem' }}>
                {[
                  { step: '1', icon: <Upload size={28} />, title: 'Upload Resumes', desc: 'Go to Candidates, upload PDF resumes. They auto-save to the database.' },
                  { step: '2', icon: <FileText size={28} />, title: 'Set Job Requirements', desc: 'Enter the role description and skills you need from ideal candidates.' },
                  { step: '3', icon: <Play size={28} />, title: 'Run AI Analysis', desc: 'Select candidates, hit Run Analysis. AI ranks them with scores & insights.' },
                  { step: '4', icon: <Filter size={28} />, title: 'Filter & Sort', desc: 'Use Top 3/5/10 filters to see the best-fit candidates ranked by score.' },
                ].map(item => (
                  <div key={item.step} style={{ background: 'var(--color-surface)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(168,85,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, color: 'var(--color-primary)' }}>{item.step}</div>
                    <div style={{ color: 'var(--color-primary)', marginBottom: '1rem' }}>{item.icon}</div>
                    <h4 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>{item.title}</h4>
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>{item.desc}</p>
                  </div>
                ))}
              </div>

              {/* Quick Actions */}
              <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>Quick Actions</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', marginBottom: '3rem' }}>
                <div onClick={() => setActiveNav('candidates')} style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(124,58,237,0.05))', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(168,85,247,0.2)', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s' }} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 25px rgba(168,85,247,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                  <Users size={24} color="var(--color-primary)" />
                  <h4 style={{ marginTop: '0.75rem', marginBottom: '0.25rem' }}>Database Candidates</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Upload & rank resumes from your talent pool.</p>
                </div>
                <div onClick={() => setActiveNav('manual')} style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(6,95,70,0.05))', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(16,185,129,0.2)', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s' }} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 25px rgba(16,185,129,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                  <FileText size={24} color="var(--color-success)" />
                  <h4 style={{ marginTop: '0.75rem', marginBottom: '0.25rem' }}>Manual Analysis</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Quick compare without saving to database.</p>
                </div>
                <div onClick={() => setActiveNav('myresume')} style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(180,83,9,0.05))', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(245,158,11,0.2)', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s' }} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 25px rgba(245,158,11,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                  <UserCheck size={24} color="var(--color-warning)" />
                  <h4 style={{ marginTop: '0.75rem', marginBottom: '0.25rem' }}>Analyze My Resume</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Get personal score & improvement tips.</p>
                </div>
              </div>

              {/* Features Grid */}
              <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>Platform Features</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                {[
                  { icon: <Zap size={20} />, title: 'AI-Powered Ranking', desc: 'Gemini AI evaluates each resume against your job requirements and assigns a fit score from 0-100 with detailed metrics.' },
                  { icon: <Star size={20} />, title: 'Competency Mapping', desc: 'Visualize candidate skills across System Design, Leadership, Frontend, Backend, and DevOps with radar charts.' },
                  { icon: <Filter size={20} />, title: 'Top-N Filtering', desc: 'After analysis, quickly filter to see Top 3, Top 5, Top 10, or Top 50 candidates to shortlist efficiently.' },
                  { icon: <UserCheck size={20} />, title: 'Self-Analysis Mode', desc: 'Upload your own resume, paste a job description, and get personalized improvement suggestions to increase your chances.' },
                  { icon: <Database size={20} />, title: 'Persistent Storage', desc: 'All candidates uploaded via the Candidates tab are stored in MongoDB Atlas — accessible across sessions.' },
                  { icon: <ShieldCheck size={20} />, title: 'Privacy in Manual Mode', desc: 'Manual analysis is 100% in-memory — nothing is saved to the database. Perfect for quick comparisons.' },
                ].map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: '1rem', padding: '1.25rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(168,85,247,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', flexShrink: 0 }}>{f.icon}</div>
                    <div>
                      <h4 style={{ marginBottom: '0.3rem', fontSize: '0.95rem' }}>{f.title}</h4>
                      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
           </div>
           );
        })() : activeNav === 'manual' ? (
          <>
          {/* Manual Mode - Left Column */}
          <div className="matches-column">
            <div className="column-header">
              <div>
                <h2 style={{ fontSize: '1.25rem' }}>Manual Analysis</h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No database — analyze on the fly</p>
              </div>
            </div>

            <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem', display: 'block' }}>Job Requirements / Prompt</label>
              <textarea 
                className="input-base" 
                placeholder="e.g. Seeking a Senior React Developer..." 
                value={manualJobReq}
                onChange={(e) => setManualJobReq(e.target.value)}
                style={{ minHeight: '70px', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                {manualEntries.map((entry, index) => (
                  <div key={entry.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', background: 'var(--color-surface)', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    <span style={{ width: '24px', color: 'var(--color-primary)', fontWeight: 'bold', fontSize: '0.85rem', textAlign: 'center', flexShrink: 0 }}>{index + 1}</span>
                    <input type="text" placeholder="Name" className="input-base" style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.85rem', border: '1px solid var(--color-border)' }} value={entry.name} onChange={(e) => setManualEntries(prev => prev.map(p => p.id === entry.id ? { ...p, name: e.target.value } : p))} />
                    <label style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--color-border)', cursor: 'pointer', fontSize: '0.8rem', color: entry.file ? 'var(--color-success)' : 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      <Upload size={14} style={{ flexShrink: 0 }} />
                      {entry.file ? entry.file.name : 'Choose PDF'}
                      <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => { const file = e.target.files[0]; if (file) setManualEntries(prev => prev.map(p => p.id === entry.id ? { ...p, file, text: '' } : p)); }} />
                    </label>
                    <button onClick={() => setManualEntries(prev => prev.filter(p => p.id !== entry.id))} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', flexShrink: 0, padding: '4px' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--color-danger)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-muted)'}><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <button onClick={() => setManualEntries(prev => [...prev, { id: Date.now(), name: '', file: null, text: '' }])} style={{ flex: 1, background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.8rem' }}><Plus size={16} /> Add Resume</button>
                <button onClick={handleManualAnalyze} disabled={isAnalyzing} style={{ flex: 1, background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', padding: '0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 'bold', fontSize: '0.8rem' }}><Play size={14} fill="currentColor" /> Analyze</button>
              </div>

              {Object.keys(manualResultsMap).length > 0 && (
                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Results ({Object.keys(manualResultsMap).length})</p>
                  {Object.values(manualResultsMap).sort((a,b) => b.score - a.score).map(res => (
                    <div key={res.originalId} onClick={() => setActiveManualId(res.originalId)} style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', background: activeManualId === res.originalId ? 'var(--color-surface-hover)' : 'var(--color-surface)', marginBottom: '0.5rem', cursor: 'pointer', border: activeManualId === res.originalId ? '1px solid var(--color-primary)' : '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.75rem', borderLeft: activeManualId === res.originalId ? '4px solid var(--color-primary)' : undefined }}>
                      <div className="avatar" style={{ width: 36, height: 36, fontSize: '0.8rem', flexShrink: 0 }}>{res.name?.charAt(0)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ display: 'block', fontSize: '0.9rem' }}>{res.name}</strong>
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{res.keywords?.[0]}</span>
                      </div>
                      <span style={{ fontWeight: 'bold', fontSize: '1rem', color: res.score >= 70 ? 'var(--color-success)' : res.score >= 50 ? 'var(--color-warning)' : 'var(--color-text)' }}>{res.score}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Manual Mode — Right Detail Column */}
          <div className="details-column">
            {(() => { const manualResult = manualResultsMap[activeManualId]; return !manualResult ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3, flexDirection: 'column', gap: '1rem' }}>
                <FileText size={80} />
                <h2>Run analysis to see results here</h2>
              </div>
            ) : (
              <>
                <div className="detail-header">
                  <div className="detail-title">
                    <h1>{manualResult.name} <span className="badge">MANUAL</span></h1>
                    <p className="summary-content" style={{ maxWidth: '600px', fontSize: '1.25rem', opacity: 0.8 }}>{manualResult.summary}</p>
                  </div>
                  <CircularScore score={manualResult.score} />
                </div>
                <div className="analysis-summary">
                  <h3 className="flex-row gap-2" style={{ color: 'var(--color-primary)' }}><Info size={20} /> AI Analysis</h3>
                  <div className="summary-grid">
                    <div className="metric-item"><span className="label">Technical Fit</span><span className="value" style={{ color: 'var(--color-primary)' }}>{manualResult.metrics?.technicalFit || 'N/A'}</span></div>
                    <div className="metric-item"><span className="label">Culture Match</span><span className="value" style={{ color: 'var(--color-warning)' }}>{manualResult.metrics?.cultureMatch || 'N/A'}</span></div>
                    <div className="metric-item"><span className="label">Retention Risk</span><span className="value" style={{ color: 'var(--color-success)' }}>{manualResult.metrics?.retentionRisk || 'Low'}</span></div>
                  </div>
                </div>
                <div className="expertise-grid">
                  <div>
                    <h3 style={{ marginBottom: '1.5rem' }}>Verified Expertise</h3>
                    {manualResult.verifiedExpertise?.map((skill, i) => (<div key={i} className="skill-bar-item"><div className="skill-info"><span>{skill.name}</span><span style={{ color: 'var(--color-primary)' }}>{skill.level}</span></div><div className="skill-track"><motion.div className="skill-progress" initial={{ width: 0 }} animate={{ width: `${skill.score}%` }} /></div></div>))}
                    <div style={{ marginTop: '2rem' }}><h4 className="label" style={{ marginBottom: '0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Keywords</h4><div className="tag-container">{manualResult.keywords?.map((k, i) => <span key={i} className="tag">{k}</span>)}</div></div>
                    <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div><h4 style={{ color: 'var(--color-success)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Strengths</h4><ul style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', paddingLeft: '1.25rem' }}>{manualResult.strengths?.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                      <div><h4 style={{ color: 'var(--color-danger)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Weaknesses</h4><ul style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', paddingLeft: '1.25rem' }}>{manualResult.weaknesses?.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                    </div>
                  </div>
                  <div><h3 style={{ marginBottom: '1.5rem' }}>Competency Map</h3><RadarChart data={manualResult.competencyMap} /></div>
                </div>
              </>
            ); })()}
          </div>
          </>
        ) : activeNav === 'myresume' ? (
          <div style={{ display: 'block', overflowY: 'auto', padding: '3rem', maxWidth: '960px', margin: '0 auto' }}>
            <div style={{ marginBottom: '2rem' }}>
              <h1 style={{ fontSize: '2.5rem', fontWeight: 800, background: 'linear-gradient(to right, #fff, var(--color-primary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Analyze My Resume</h1>
              <p style={{ color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>Get personalized feedback, score, and improvement tips for any job you're applying to.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
              <div style={{ background: 'var(--color-surface)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>Your Resume (PDF)</label>
                <div onClick={() => selfFileRef.current?.click()} style={{ padding: '2rem', border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)', textAlign: 'center', cursor: 'pointer', background: 'rgba(0,0,0,0.2)', color: selfFile ? 'var(--color-success)' : 'var(--color-text-muted)', transition: 'border-color 0.2s' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}>
                  <Upload size={32} style={{ margin: '0 auto 0.5rem' }} />
                  <p style={{ fontWeight: 600 }}>{selfFile ? selfFile.name : 'Click to upload your resume'}</p>
                </div>
                <input type="file" accept=".pdf" ref={selfFileRef} style={{ display: 'none' }} onChange={e => setSelfFile(e.target.files[0])} />
                
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '1rem', marginBottom: '0.5rem', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>CGPA (Optional)</label>
                <input type="text" placeholder="e.g. 8.5 / 10" className="input-base" value={selfCgpa} onChange={e => setSelfCgpa(e.target.value)} />
              </div>
              <div style={{ background: 'var(--color-surface)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>Job Description You're Applying For</label>
                <textarea className="input-base" placeholder="Paste the full job description here..." value={selfJobDesc} onChange={e => setSelfJobDesc(e.target.value)} style={{ minHeight: '200px', fontSize: '0.9rem' }} />
              </div>
            </div>

            <button onClick={handleSelfAnalyze} disabled={isSelfAnalyzing} style={{ background: 'linear-gradient(135deg, #a855f7, #7c3aed)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', padding: '1rem 3rem', cursor: 'pointer', fontWeight: 700, fontSize: '1rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 20px rgba(168,85,247,0.3)' }}>
              {isSelfAnalyzing ? <><Star size={18} className="spin" /> Analyzing...</> : <><Play size={18} fill="currentColor" /> Analyze My Resume</>}
            </button>

            {selfResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* Score Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', background: 'var(--color-surface)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                  <CircularScore score={selfResult.overallScore} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>Your Score</h2>
                      <span style={{ padding: '0.3rem 1rem', borderRadius: 'var(--radius-full)', fontWeight: 700, fontSize: '0.8rem', background: selfResult.overallScore >= 80 ? 'rgba(16,185,129,0.15)' : selfResult.overallScore >= 60 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)', color: selfResult.overallScore >= 80 ? 'var(--color-success)' : selfResult.overallScore >= 60 ? 'var(--color-warning)' : 'var(--color-danger)' }}>{selfResult.verdict}</span>
                      <span style={{ padding: '0.3rem 1rem', borderRadius: 'var(--radius-full)', fontWeight: 700, fontSize: '0.8rem', background: 'rgba(168,85,247,0.1)', color: 'var(--color-primary)' }}>Interview Chance: {selfResult.estimatedInterviewChance}</span>
                    </div>
                    <p style={{ color: 'var(--color-text-muted)', lineHeight: '1.7', fontSize: '1rem' }}>{selfResult.summary}</p>
                  </div>
                </div>

                {/* Skills Match Table */}
                <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                  <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--color-border)' }}><h3>Skills Match Analysis</h3></div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--color-border)' }}><th style={{ padding: '0.75rem 1.5rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Skill</th><th style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Your Level</th><th style={{ padding: '0.75rem 1.5rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Importance</th></tr></thead>
                    <tbody>{selfResult.keySkillsMatch?.map((s, i) => (<tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}><td style={{ padding: '0.75rem 1.5rem', fontWeight: 600 }}>{s.skill}</td><td style={{ padding: '0.75rem', textAlign: 'center' }}><span style={{ padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 600, background: s.resumeLevel === 'Strong' ? 'rgba(16,185,129,0.1)' : s.resumeLevel === 'Moderate' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', color: s.resumeLevel === 'Strong' ? 'var(--color-success)' : s.resumeLevel === 'Moderate' ? 'var(--color-warning)' : 'var(--color-danger)' }}>{s.resumeLevel}</span></td><td style={{ padding: '0.75rem 1.5rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{s.importance}</td></tr>))}</tbody>
                  </table>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  {/* What to Improve */}
                  <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: '1.5rem' }}>
                    <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary)' }}><Star size={18} /> What to Add / Improve</h3>
                    <ul style={{ paddingLeft: '1.25rem', fontSize: '0.9rem', color: 'var(--color-text-muted)', lineHeight: '1.8' }}>{selfResult.improvements?.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  </div>
                  {/* Missing Skills */}
                  <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: '1.5rem' }}>
                    <h3 style={{ marginBottom: '1rem', color: 'var(--color-danger)' }}>Missing Skills</h3>
                    <div className="tag-container" style={{ gap: '0.5rem' }}>{selfResult.missingSkills?.map((s, i) => <span key={i} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.4rem 0.8rem', borderRadius: 'var(--radius-full)', fontSize: '0.8rem', color: 'var(--color-danger)' }}>{s}</span>)}</div>
                    <h3 style={{ marginTop: '1.5rem', marginBottom: '1rem', color: 'var(--color-success)' }}>Strengths</h3>
                    <ul style={{ paddingLeft: '1.25rem', fontSize: '0.9rem', color: 'var(--color-text-muted)', lineHeight: '1.8' }}>{selfResult.strengths?.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  {/* Resume Tips */}
                  <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: '1.5rem' }}>
                    <h3 style={{ marginBottom: '1rem', color: 'var(--color-warning)' }}>Resume Tips</h3>
                    <ul style={{ paddingLeft: '1.25rem', fontSize: '0.9rem', color: 'var(--color-text-muted)', lineHeight: '1.8' }}>{selfResult.resumeTips?.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  </div>
                  {/* Competency Map */}
                  <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: '1.5rem' }}>
                    <h3 style={{ marginBottom: '1rem' }}>Competency Map</h3>
                    <RadarChart data={selfResult.competencyMap} />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
          {/* Candidates (DB) — Left Column */}
          <div className="matches-column">
            <div className="column-header">
              <div>
                <h2 style={{ fontSize: '1.25rem' }}>Candidates</h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{dbCandidates.length} in database</p>
              </div>
              <button className="badge" style={{ border: 'none', cursor: 'pointer', background: 'var(--color-primary)', color: '#fff' }} onClick={() => fileInputRef.current.click()}>
                {isUploading ? 'Uploading...' : <><Upload size={14} /> Add PDF</>}
              </button>
              <input type="file" multiple accept=".pdf" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
            </div>

            <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem', display: 'block' }}>Job Requirements / Prompt</label>
              <textarea className="input-base" placeholder="e.g. Seeking a Senior React Developer with Node.js experience." value={jobRequirements} onChange={(e) => setJobRequirements(e.target.value)} style={{ minHeight: '80px', fontSize: '0.85rem' }} />
            </div>

            {/* Top N Filter - Manual Input */}
            {Object.keys(resultsMap).length > 0 && (
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Filter size={14} color="var(--color-text-muted)" />
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Show Top:</span>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input 
                    type="number" 
                    min="1"
                    placeholder="All" 
                    value={topNFilter === 'all' ? '' : topNFilter} 
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val || parseInt(val) <= 0) setTopNFilter('all');
                      else setTopNFilter(val);
                    }}
                    style={{ 
                      width: '70px', 
                      padding: '0.3rem 0.6rem', 
                      fontSize: '0.85rem', 
                      background: 'rgba(0,0,0,0.3)', 
                      border: '1px solid var(--color-border)', 
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text)',
                      textAlign: 'center',
                      outline: 'none'
                    }} 
                    onFocus={e => e.target.style.borderColor = 'var(--color-primary)'}
                    onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                  />
                  {topNFilter !== 'all' && (
                    <button 
                      onClick={() => setTopNFilter('all')} 
                      style={{ 
                        background: 'rgba(168,85,247,0.1)', 
                        border: '1px solid rgba(168,85,247,0.2)', 
                        color: 'var(--color-primary)', 
                        fontSize: '0.7rem', 
                        cursor: 'pointer', 
                        padding: '0.2rem 0.5rem',
                        borderRadius: 'var(--radius-sm)',
                        fontWeight: 600
                      }}
                    >
                      CLEAR
                    </button>
                  )}
                </div>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {isFetchingDb && displayList.length === 0 && <p style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>Connecting to Database...</p>}
              {!isFetchingDb && displayList.length === 0 && <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}><Users size={40} style={{ margin: '0 auto 1rem', opacity: 0.5 }} /><p>No candidates found.</p><p style={{ fontSize: '0.8rem' }}>Upload some PDF resumes to get started.</p></div>}
              {(() => {
                let filtered = displayList;
                if (topNFilter !== 'all' && Object.keys(resultsMap).length > 0) {
                  const analyzed = filtered.filter(c => resultsMap[c._id]).slice(0, parseInt(topNFilter));
                  const unanalyzed = filtered.filter(c => !resultsMap[c._id]);
                  filtered = [...analyzed, ...unanalyzed];
                }
                return filtered.map((c) => {
                  const res = resultsMap[c._id]; const isSelected = selectedDbIds.has(c._id); const isActive = activeCandidateId === c._id;
                  return (
                    <div key={c._id} className={`candidate-card ${isActive ? 'active' : ''}`} onClick={() => setActiveCandidateId(c._id)}>
                      <div onClick={(e) => toggleSelection(c._id, e)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}>{isSelected ? <CheckCircle2 size={20} color="var(--color-primary)" /> : <Circle size={20} color="var(--color-text-muted)" />}</div>
                      {res?.rank && <span style={{ width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0, background: res.rank === 1 ? 'linear-gradient(135deg, #f59e0b, #d97706)' : res.rank === 2 ? 'linear-gradient(135deg, #94a3b8, #64748b)' : res.rank === 3 ? 'linear-gradient(135deg, #cd7f32, #a0622e)' : 'var(--color-surface-hover)', color: res.rank <= 3 ? '#fff' : 'var(--color-text-muted)' }}>#{res.rank}</span>}
                      <div className="avatar" style={{ flexShrink: 0 }}>{c.name?.charAt(0) || 'C'}</div>
                      <div style={{ flex: 1, minWidth: 0 }}><strong style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</strong><span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{res ? (res.keywords?.[0] || 'Analyzed') : 'Pending Analysis'}</span></div>
                      {res && <div className="fit-score-mini" style={{ flexShrink: 0 }}><span className="percent" style={{ color: res.score >= 70 ? 'var(--color-success)' : res.score >= 50 ? 'var(--color-warning)' : 'var(--color-text)' }}>{res.score}%</span></div>}
                      <button onClick={(e) => handleDelete(c._id, e)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', opacity: 0.6, flexShrink: 0, padding: '4px' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--color-danger)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-muted)'}><Trash2 size={16} /></button>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Candidates (DB) — Right Detail Column */}
          <div className="details-column">
            {!activeCandidateId ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3, flexDirection: 'column', gap: '1rem' }}><Users size={80} /><h2>Select a candidate to view details</h2></div>
            ) : (
              <>
                <div className="detail-header">
                  <div className="detail-title">
                    <h1>{activeCandidateData?.name} {activeResult && <span className="badge">ANALYZED</span>}</h1>
                    <p className="summary-content" style={{ maxWidth: '600px', fontSize: '1.25rem', opacity: 0.8 }}>{activeResult ? activeResult.summary : 'Select "Run Analysis" to generate insights for this candidate.'}</p>
                    <div className="flex-row gap-4" style={{ marginTop: '1.5rem', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}><span className="flex-row gap-2"><Briefcase size={16} /> Candidate Profile</span><span className="flex-row gap-2"><Database size={16} /> DB Stored</span></div>
                  </div>
                  {activeResult && <CircularScore score={activeResult.score} />}
                </div>
                {activeResult && (
                  <>
                    <div className="analysis-summary"><h3 className="flex-row gap-2" style={{ color: 'var(--color-primary)' }}><Info size={20} /> AI Analysis Summary</h3><div className="summary-grid"><div className="metric-item"><span className="label">Technical Fit</span><span className="value" style={{ color: 'var(--color-primary)' }}>{activeResult.metrics?.technicalFit || 'N/A'}</span></div><div className="metric-item"><span className="label">Culture Match</span><span className="value" style={{ color: 'var(--color-warning)' }}>{activeResult.metrics?.cultureMatch || 'N/A'}</span></div><div className="metric-item"><span className="label">Retention Risk</span><span className="value" style={{ color: 'var(--color-success)' }}>{activeResult.metrics?.retentionRisk || 'Low'}</span></div></div></div>
                    <div className="expertise-grid">
                      <div>
                        <h3 style={{ marginBottom: '1.5rem' }}>Verified Expertise</h3>
                        {activeResult.verifiedExpertise?.map((skill, i) => (<div key={i} className="skill-bar-item"><div className="skill-info"><span>{skill.name}</span><span style={{ color: 'var(--color-primary)' }}>{skill.level}</span></div><div className="skill-track"><motion.div className="skill-progress" initial={{ width: 0 }} animate={{ width: `${skill.score}%` }} /></div></div>))}
                        <div style={{ marginTop: '2rem' }}><h4 className="label" style={{ marginBottom: '0.75rem', fontSize: '0.7rem', textTransform: 'uppercase' }}>Top Keyword Matches</h4><div className="tag-container">{activeResult.keywords?.map((k, i) => <span key={i} className="tag">{k}</span>)}</div></div>
                        <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div><h4 style={{ color: 'var(--color-success)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Strengths</h4><ul style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', paddingLeft: '1.25rem' }}>{activeResult.strengths?.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                          <div><h4 style={{ color: 'var(--color-danger)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Weaknesses</h4><ul style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', paddingLeft: '1.25rem' }}>{activeResult.weaknesses?.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                        </div>
                      </div>
                      <div><h3 style={{ marginBottom: '1.5rem' }}>Competency Map</h3><RadarChart data={activeResult.competencyMap} /></div>
                    </div>
                  </>
                )}
                {!activeResult && activeCandidateData && (<div style={{ background: 'var(--color-surface)', padding: '2rem', borderRadius: 'var(--radius-lg)' }}><h3 style={{ marginBottom: '1rem' }}>Extracted Resume Text Preview</h3><div style={{ maxHeight: '400px', overflowY: 'auto', fontSize: '0.85rem', color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap', fontFamily: 'monospace', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-md)' }}>{activeCandidateData.resumeText}</div></div>)}
              </>
            )}
          </div>
          </>
        )}
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              style={{ width: '500px', background: 'linear-gradient(145deg, #1a172e 0%, #12101e 100%)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(168, 85, 247, 0.2)', boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(168,85,247,0.1)', position: 'relative', overflow: 'hidden' }}
            >
              {/* Decorative glow */}
              <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '120px', height: '120px', background: 'var(--color-primary)', filter: 'blur(80px)', opacity: 0.15, borderRadius: '50%' }}></div>
              
              <div className="flex-row justify-between items-center" style={{ marginBottom: '2rem' }}>
                <div className="flex-row gap-2">
                  <div style={{ background: 'linear-gradient(135deg, var(--color-primary), #7c3aed)', width: '40px', height: '40px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Settings size={22} color="#fff" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.3rem', margin: 0, fontWeight: 700 }}>Configuration</h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>Manage your AI settings</p>
                  </div>
                </div>
                <button onClick={() => setShowSettings(false)} style={{ background: 'var(--color-surface)', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* API Key Input */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <Key size={14} /> Gemini AI API Key
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input type="password" placeholder="Enter your API key..." value={apiKey} onChange={(e) => { setApiKey(e.target.value); setApiUsage(null); }} className="input-base" style={{ border: '1px solid rgba(168, 85, 247, 0.3)', paddingRight: '3rem', background: 'rgba(0,0,0,0.5)' }} />
                    {apiKey && (
                      <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}>
                        {apiUsage?.status === 'active' ? <CheckCircle2 size={18} color="var(--color-success)" /> : apiUsage?.status === 'invalid' ? <AlertTriangle size={18} color="var(--color-danger)" /> : <Key size={18} color="var(--color-text-muted)" style={{ opacity: 0.4 }} />}
                      </div>
                    )}
                  </div>
                </div>

                {/* API Status Card */}
                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-md)', padding: '1rem', border: '1px solid var(--color-border)' }}>
                  <div className="flex-row justify-between items-center" style={{ marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Zap size={14} /> API Status</span>
                    <button 
                      onClick={() => checkApiUsage()} 
                      disabled={isCheckingUsage || !apiKey}
                      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.75rem', color: apiKey ? 'var(--color-primary)' : 'var(--color-text-muted)', cursor: apiKey ? 'pointer' : 'not-allowed', fontSize: '0.75rem', fontWeight: 600 }}
                    >
                      {isCheckingUsage ? 'Checking...' : 'Verify Key'}
                    </button>
                  </div>
                  {apiUsage ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: apiUsage.status === 'active' ? 'rgba(16,185,129,0.1)' : apiUsage.status === 'rate_limited' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-sm)', border: `1px solid ${apiUsage.status === 'active' ? 'rgba(16,185,129,0.2)' : apiUsage.status === 'rate_limited' ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: apiUsage.status === 'active' ? 'var(--color-success)' : apiUsage.status === 'rate_limited' ? 'var(--color-warning)' : 'var(--color-danger)', boxShadow: `0 0 8px ${apiUsage.status === 'active' ? 'var(--color-success)' : apiUsage.status === 'rate_limited' ? 'var(--color-warning)' : 'var(--color-danger)'}`, flexShrink: 0 }}></div>
                      <span style={{ fontSize: '0.85rem', color: apiUsage.status === 'active' ? 'var(--color-success)' : apiUsage.status === 'rate_limited' ? 'var(--color-warning)' : 'var(--color-danger)', fontWeight: 500 }}>{apiUsage.message}</span>
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', opacity: 0.6 }}>Click "Verify Key" to check if your API key is valid and within rate limits.</p>
                  )}
                  <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '0.75rem', opacity: 0.5, lineHeight: '1.5' }}>
                    Free tier: 30 requests/min, 1500 requests/day. Usage resets daily.
                  </p>
                </div>
                
                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button 
                    onClick={() => setShowSettings(false)}
                    style={{ flex: 1, padding: '0.85rem', background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Cancel
                  </button>
                  <button 
                    style={{ flex: 2, padding: '0.85rem', background: 'linear-gradient(135deg, #a855f7, #7c3aed)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem', boxShadow: '0 4px 20px rgba(168,85,247,0.3)' }} 
                    onClick={() => { localStorage.setItem('gemini_api_key', apiKey); setShowSettings(false); setSuccessMsg('Settings saved!'); setTimeout(() => setSuccessMsg(''), 2000); }}
                  >
                    Save Settings
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help Modal */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="glass-panel" style={{ width: '500px', background: 'var(--color-sidebar)', padding: '2.5rem', maxHeight: '80vh', overflowY: 'auto' }}
            >
              <div className="flex-row justify-between items-center" style={{ marginBottom: '2rem' }}>
                <h3 style={{ fontSize: '1.5rem', margin: 0 }}><HelpCircle size={24} /> How to Use</h3>
                <button onClick={() => setShowHelp(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={24} /></button>
              </div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem', lineHeight: '1.6' }}>
                <p style={{ marginBottom: '1rem' }}>Welcome to <strong>Resume Sorter</strong>! Here is how to use the platform:</p>
                <ul style={{ paddingLeft: '1.5rem', marginBottom: '1.5rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}><strong>Settings:</strong> First, add your Gemini API Key in the Settings menu so the AI can function.</li>
                  <li style={{ marginBottom: '0.5rem' }}><strong>Database Upload:</strong> On the Candidates tab, click "Add PDF" to upload resumes. They will be saved to your local database.</li>
                  <li style={{ marginBottom: '0.5rem' }}><strong>Analyze:</strong> Select the checkboxes next to the candidates you want to analyze, type in the desired Job Requirements, and click "Run Analysis".</li>
                  <li style={{ marginBottom: '0.5rem' }}><strong>Manual Mode:</strong> Use Manual Mode to upload resumes and analyze them on the fly <em>without</em> saving them to the database.</li>
                  <li style={{ marginBottom: '0.5rem' }}><strong>Dashboard:</strong> View AI insights and aggregate data in the Dashboard once analysis is complete.</li>
                </ul>
                <p>During analysis, if you click "Stop Analysis", it will cancel any remaining resumes from being processed.</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isAnalyzing && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
              style={{ width: '60px', height: '60px', border: '4px solid rgba(168, 85, 247, 0.2)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', marginBottom: '2rem' }}
            />
            <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>AI is Analyzing Candidates...</h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>Please wait while we evaluate the resumes.</p>
            <button 
              onClick={handleCancelAnalysis} 
              style={{ background: 'var(--color-danger)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', padding: '0.75rem 2rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem' }}
            >
              Cancel Analysis
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toaster */}
      {successMsg && (
        <div style={{ position: 'fixed', bottom: '2rem', right: '2rem', background: 'var(--color-success)', color: '#fff', padding: '1rem 2rem', borderRadius: 'var(--radius-md)', zIndex: 1000, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
          {successMsg}
        </div>
      )}

      {error && (
        <div style={{ position: 'fixed', bottom: '2rem', right: '2rem', background: 'var(--color-danger)', color: '#fff', padding: '1rem 2rem', borderRadius: 'var(--radius-md)', zIndex: 1000, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
          <div className="flex-row gap-2"><AlertTriangle size={20} /> {error}</div>
        </div>
      )}
    </div>
  );
}

export default App;
