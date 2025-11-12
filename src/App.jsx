import React, { useState, useEffect, useContext, createContext, useMemo, useCallback, memo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ComposedChart, Line
} from 'recharts';
import {
  LayoutDashboard, Users, TrendingUp, LogOut,
  ChevronRight, Filter, Download, Search, AlertTriangle, CheckCircle2,
  BarChart2, Map, UserCircle, Lock, Menu, X,
  GraduationCap, Target, Eye, Layers, ChevronDown, ArrowLeft,
  Info, BookOpen, ThumbsUp
} from 'lucide-react';
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut,
  sendPasswordResetEmail
} from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  getDoc,
  onSnapshot
} from "firebase/firestore";

// --- 1. FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBscb4A2WCQ97vaViJeoAZLY1g4eZYntG4",
  authDomain: "ctl-competency-self-assess.firebaseapp.com",
  databaseURL: "https://ctl-competency-self-assess-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ctl-competency-self-assess",
  storageBucket: "ctl-competency-self-assess.firebasestorage.app",
  messagingSenderId: "80128970872",
  appId: "1:80128970872:web:2556c78cf4142141185d8d",
  measurementId: "G-R1WLKEFF3F"
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- 2. AUTHENTICATION CONTEXT ---
const AuthContext = createContext(null);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Get custom claims (role, division)
        const tokenResult = await user.getIdTokenResult();
        const claims = tokenResult.claims;
        
        setUser({
          uid: user.uid,
          email: user.email,
          name: user.displayName,
          role: claims.role || 'staff', // Default to 'staff' if no role
          division: claims.division || 'N/A'
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = useCallback(async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

// --- 3. DATABASE CONTEXT (NOW OPTIMIZED) ---
const DatabaseContext = createContext(null);

const DatabaseProvider = ({ children }) => {
  // --- OPTIMIZATION 1: Split raw data from processed data ---
  const [rawData, setRawData] = useState(null); 
  const [loading, setLoading] = useState(true);

  // This useEffect just fetches the raw data and does nothing else.
  useEffect(() => {
    const docRef = doc(db, "ctl_dashboard", "main_data_v1");
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setRawData(docSnap.data());
      } else {
        console.error("Data document not found! Make sure you have run the upload script.");
        setRawData(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []); // Runs only once on mount

  // --- OPTIMIZATION 2: All processing is moved into a useMemo hook ---
  // This entire block only re-runs if `rawData` changes.
  const processedData = useMemo(() => {
    if (!rawData) {
      return null;
    }
    
    const { competencyLibrary, individualData, orgMetrics, divisionData } = rawData;

    // Calculate aggregate priorities
    let competencyAggregates = {};
    Object.values(individualData).forEach(staff => {
      staff.competencies.forEach(comp => {
        if (!competencyAggregates[comp.name]) {
          competencyAggregates[comp.name] = { staffWithGap: 0, totalGapSize: 0 };
        }
        if (comp.gap > 0) {
          competencyAggregates[comp.name].staffWithGap++;
          competencyAggregates[comp.name].totalGapSize += comp.gap;
        }
      });
    });
    
    const totalRespondents = orgMetrics.TotalRespondents;
    const processedPriorities = Object.keys(competencyAggregates).map(name => {
      const agg = competencyAggregates[name];
      const libData = competencyLibrary[name] || {};
      const gapRate = (agg.staffWithGap / totalRespondents) * 100;
      const avgGapSize = agg.staffWithGap > 0 ? agg.totalGapSize / agg.staffWithGap : 0;
      const priority = gapRate * avgGapSize; 
      
      let category = 'LOW';
      if (priority > 80) category = 'CRITICAL';
      else if (priority > 60) category = 'HIGH';
      else if (priority > 40) category = 'MEDIUM';

      return {
        name,
        group: libData.group || 'Other',
        description: libData.description || 'N/A',
        staffCount: agg.staffWithGap,
        gapRate: parseFloat(gapRate.toFixed(1)),
        avgGapSize: parseFloat(avgGapSize.toFixed(1)),
        priority: parseFloat(priority.toFixed(1)),
        category
      };
    }).sort((a, b) => b.priority - a.priority);
    
    // Process Individual Data to add group calcs
    const processedIndividualData = {};
    Object.keys(individualData).forEach(email => {
      const user = individualData[email];
      // --- FIX 1 (from BUG_FIX_SUMMARY.md) ---
      const groupData = {
        'Core Technical': { current: [], required: [], competencies: [] },
        'Analytical Toolkit': { current: [], required: [], competencies: [] }, // ✅ ADDED
        'Behavioral': { current: [], required: [], competencies: [] },
        'Future-Ready': { current: [], required: [], competencies: [] },
      };

      user.competencies.forEach(comp => {
        const compInfo = competencyLibrary[comp.name] || {};
        comp.group = compInfo.group || 'Other';
        comp.description = compInfo.description || 'N/A';
        const priorityInfo = processedPriorities.find(p => p.name === comp.name);
        comp.priority = priorityInfo ? priorityInfo.category : 'LOW';

        if (comp.group in groupData) { // Check if group is valid before pushing
          groupData[comp.group].current.push(comp.current);
          groupData[comp.group].required.push(comp.required);
          groupData[comp.group].competencies.push(comp);
        }
      });
      
      const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

      const groupRadar = Object.keys(groupData).map(groupName => ({
        subject: groupName,
        A: avg(groupData[groupName].current),
        B: avg(groupData[groupName].required),
        fullMark: 5,
      }));

      const competencyRadar = {};
      Object.keys(groupData).forEach(groupName => {
        competencyRadar[groupName] = groupData[groupName].competencies.map(comp => ({
          subject: comp.name.split(' ').slice(0, 2).join(' '),
          A: comp.current,
          B: comp.required,
          fullMark: 5,
        }));
      });

      processedIndividualData[email] = {
        ...user,
        competencies: user.competencies.sort((a, b) => (b.gap || 0) - (a.gap || 0)),
        groupRadarData: groupRadar,
        competencyRadarData: competencyRadar,
      };
    });
    
    // Calculate Group Priority Data
    // --- FIX 2 (from BUG_FIX_SUMMARY.md) ---
    const groupAggregates = {
      'Core Technical': { totalGapRate: 0, staffAffected: 0, priority: 0, count: 0 },
      'Analytical Toolkit': { totalGapRate: 0, staffAffected: 0, priority: 0, count: 0 }, // ✅ ADDED
      'Behavioral': { totalGapRate: 0, staffAffected: 0, priority: 0, count: 0 },
      'Future-Ready': { totalGapRate: 0, staffAffected: 0, priority: 0, count: 0 },
    };

    processedPriorities.forEach(comp => {
      if (groupAggregates[comp.group]) {
        groupAggregates[comp.group].totalGapRate += comp.gapRate;
        groupAggregates[comp.group].staffAffected += comp.staffCount;
        groupAggregates[comp.group].priority += comp.priority;
        groupAggregates[comp.group].count++;
      }
    });

    // --- FIX 3 (from BUG_FIX_SUMMARY.md) ---
    const groupPriorityData = [
      { name: 'Core Technical', ...groupAggregates['Core Technical'], color: 'bg-blue-500', icon: Target },
      { name: 'Analytical Toolkit', ...groupAggregates['Analytical Toolkit'], color: 'bg-purple-500', icon: BarChart2 }, // ✅ ADDED
      { name: 'Future-Ready', ...groupAggregates['Future-Ready'], color: 'bg-indigo-500', icon: TrendingUp },
      { name: 'Behavioral', ...groupAggregates['Behavioral'], color: 'bg-emerald-500', icon: Users },
    ].map(g => ({
      ...g,
      avgGapRate: g.count > 0 ? g.totalGapRate / g.count : 0,
    }));

    // Calculate Heatmap Data
    let heatmapAgg = {};
    Object.values(processedIndividualData).forEach(staff => {
      staff.competencies.forEach(comp => {
        const key = `${comp.name}_${staff.division}`;
        if (!heatmapAgg[key]) {
          heatmapAgg[key] = { name: comp.name, group: comp.group, division: staff.division, scores: [] };
        }
        heatmapAgg[key].scores.push(comp.current);
      });
    });

    let heatmapByComp = {};
    Object.values(heatmapAgg).forEach(agg => {
      if (!heatmapByComp[agg.name]) {
        heatmapByComp[agg.name] = { 
          competency: agg.name, 
          group: agg.group,
          CTOC: 0, CTLA: 0, CTAC: 0, CTFA: 0
        };
      }
      const avgScore = agg.scores.length ? agg.scores.reduce((a,b) => a+b, 0) / agg.scores.length : 0;
      if (agg.division in heatmapByComp[agg.name]) { // Check if division key exists
        heatmapByComp[agg.name][agg.division] = avgScore;
      }
    });

    // Return the final, processed data object
    return {
      orgMetrics: orgMetrics,
      divisionData: divisionData,
      competencyPriorities: processedPriorities,
      groupPriorityData: groupPriorityData,
      heatmapData: Object.values(heatmapByComp),
      individualData: processedIndividualData,
      competencyLibrary: competencyLibrary,
    };
    
  }, [rawData]); // The dependency is only on rawData

  return (
    <DatabaseContext.Provider value={{ ...processedData, loading }}>
      {!loading && children}
    </DatabaseContext.Provider>
  );
};


// --- 4. REUSABLE COMPONENTS (No data logic) ---

// --- OPTIMIZATION: Wrap in memo ---
const LoginPage = memo(() => {
  const { login } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [view, setView] = useState('login'); 
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');

  // --- OPTIMIZATION: Wrap in useCallback ---
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError('Invalid email or password. Please try again.');
      setLoading(false);
    }
  }, [email, password, login]);
  
  // --- OPTIMIZATION: Wrap in useCallback ---
  const handlePasswordReset = useCallback(async (e) => {
    e.preventDefault();
    setResetLoading(true);
    setResetError('');
    setResetSuccess('');
    
    const continueUrl = `https://${firebaseConfig.authDomain}`;
    console.log("Attempting password reset with continue URL:", continueUrl);

    try {
      const actionCodeSettings = {
        url: continueUrl, 
        handleCodeInApp: false
      };
      await sendPasswordResetEmail(auth, resetEmail, actionCodeSettings);
      setResetSuccess('Success! Please check your email (including Spam folder) for the setup link.');
    } catch (err) {
      console.error("Password reset error: ", err);
      let msg = 'An error occurred. Please try again.';
      
      if (err.code === 'auth/invalid-continue-uri') {
        msg = 'Configuration Error: The app\'s domain is not authorized. Please contact your administrator.';
        console.error(`ERROR: The domain '${continueUrl}' must be added to the "Authorized domains" list in your Firebase Authentication settings.`);
      } else if (err.code === 'auth/user-not-found') {
        setResetSuccess('Success! If an account exists, a setup link has been sent to your email.');
      } else if (err.code === 'auth/invalid-email') {
        msg = 'Please enter a valid email address.';
      } else {
        console.log("Firebase error code:", err.code);
        msg = 'An error occurred. Please try again later.';
      }
      if (!resetSuccess) {
        setResetError(msg);
      }
    }
    setResetLoading(false);
  }, [resetEmail]); // Dependency on resetEmail

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
        <div className="text-center mb-8">
          <div className="bg-blue-600 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">CTL Competency Manager</h1>
          <p className="text-slate-500">
            {view === 'login' ? 'Sign in to access your dashboard' : 'First-time Login / Reset Password'}
          </p>
        </div>

        {view === 'login' ? (
          <>
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm flex items-center">
                <AlertTriangle className="w-4 h-4 mr-2" />
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                <div className="relative">
                  <UserCircle className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" placeholder="name@ctl.org" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" placeholder="••••••••" required />
                </div>
              </div>
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors" disabled={loading}>
                {loading ? 'Signing In...' : 'Sign In'}
              </button>
            </form>
            <div className="text-center mt-4">
              <button 
                onClick={() => setView('reset')}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                First-time Login / Forgot Password?
              </button>
            </div>
          </>
        ) : (
          <>
            {resetSuccess && (
              <div className="bg-green-50 text-green-700 p-3 rounded-lg mb-4 text-sm flex items-center">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                {resetSuccess}
              </div>
            )}
            {resetError && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm flex items-center">
                <AlertTriangle className="w-4 h-4 mr-2" />
                {resetError}
              </div>
            )}
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                <p className="text-xs text-slate-500 mb-2">Enter your work email to receive a password setup link.</p>
                <div className="relative">
                  <UserCircle className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                  <input type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" placeholder="name@ctl.org" required />
                </div>
              </div>
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors" disabled={resetLoading}>
                {resetLoading ? 'Sending...' : 'Send Setup Link'}
              </button>
            </form>
            <div className="text-center mt-4">
              <button 
                onClick={() => setView('login')}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Back to Login
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

const CompetencyInfo = memo(({ description }) => {
  if (!description) return null;
  return (
    <div className="relative group ml-1.5">
      <Info className="w-4 h-4 text-slate-400 cursor-help" />
      <div className="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2 w-64
                    bg-slate-800 text-white text-xs rounded-lg p-3 shadow-lg
                    opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {description}
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800"></div>
      </div>
    </div>
  );
});

const RatingScaleModal = memo(({ isOpen, onClose }) => {
  if (!isOpen) return null;
  const ratings = [
    { level: 1, title: 'Novice', description: 'Has basic knowledge or awareness of the concept. Requires significant guidance and supervision.' },
    { level: 2, title: 'Learner', description: 'Can perform basic tasks with supervision. Is developing skills and understanding.' },
    { level: 3, title: 'Practitioner', description: 'Proficient. Can perform tasks independently and effectively. Can assist others.' },
    { level: 4, title: 'Expert', description: 'Has deep expertise. Can handle complex situations and guide others. A go-to person.' },
    { level: 5, title: 'Master', description: 'Is a recognized authority. Can innovate, set strategy, and teach all levels of the competency.' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-slate-800">Rating Scale Definitions</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-full">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="space-y-4">
          {ratings.map(rating => (
            <div key={rating.level} className="flex items-start">
              <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white text-xl font-bold rounded-lg flex items-center justify-center">
                {rating.level}
              </div>
              <div className="ml-4">
                <h4 className="font-semibold text-lg text-slate-700">{rating.title}</h4>
                <p className="text-sm text-slate-600">{rating.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

const MetricCard = memo(({ title, value, subtitle, icon: Icon, color }) => (
  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-slate-800">{value}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
      </div>
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
    </div>
  </div>
));

const GroupMetricCard = memo(({ title, value, subtitle, icon: Icon, color, onClick, isSelected }) => (
  <button
    onClick={onClick}
    className={`bg-white p-6 rounded-xl border-2 shadow-sm hover:shadow-md transition-all text-left w-full ${isSelected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-slate-200 hover:border-slate-300'}`}
  >
    <div className="flex justify-between items-start">
      <div>
        <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-slate-800">{value}</h3>
        <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
      </div>
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
    </div>
  </button>
));

const PriorityBadge = memo(({ category }) => {
  const colors = {
    CRITICAL: 'bg-red-100 text-red-800 border-red-200',
    HIGH: 'bg-orange-100 text-orange-800 border-orange-200',
    MEDIUM: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    LOW: 'bg-green-100 text-green-800 border-green-200',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[category] || colors.LOW}`}>
      {category}
    </span>
  );
});

const FeedbackCard = memo(({ icon: Icon, title, content }) => (
  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
    <div className="flex items-center gap-3 mb-2">
      <Icon className="w-6 h-6 text-blue-600" />
      <h4 className="font-semibold text-slate-700">{title}</h4>
    </div>
    <p className="text-slate-600 text-sm">{content}</p>
  </div>
));

const exportToCSV = (data, filename) => {
  const headers = ["Competency", "Group", "Priority Score", "Staff Affected", "Gap Rate", "Category"];
  let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";
  data.forEach(item => {
    const row = [item.name, item.group || '', item.priority || '', item.staffCount || '', item.gapRate || '', item.category || ''];
    csvContent += row.join(",") + "\n";
  });
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// --- 5. DATA-CONNECTED DASHBOARD VIEWS ---

const AdminDashboard = memo(() => {
  const { orgMetrics, competencyPriorities, groupPriorityData, divisionData } = useContext(DatabaseContext);
  const [selectedGroup, setSelectedGroup] = useState('ALL');

  const filteredCompetencies = useMemo(() => {
    if (selectedGroup === 'ALL') {
      return competencyPriorities;
    }
    return competencyPriorities.filter(c => c.group === selectedGroup);
  }, [selectedGroup, competencyPriorities]);

  const handleExport = useCallback(() => {
    exportToCSV(filteredCompetencies, "competency_priorities.csv");
  }, [filteredCompetencies]);

  const handleGroupClick = useCallback((groupName) => {
    setSelectedGroup(groupName);
  }, []);

  const handleClearFilter = useCallback(() => {
    setSelectedGroup('ALL');
  }, []);

  if (!orgMetrics) return <div>Loading Admin Dashboard...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Organization Overview</h2>
          <p className="text-slate-500">Analysis based on {orgMetrics.TotalRespondents} staff assessments</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard title="Overall Gap Rate" value={`${orgMetrics.OverallGapRate}%`} subtitle={`${orgMetrics.AssessmentswithGaps.toLocaleString()} total gaps`} icon={AlertTriangle} color="bg-rose-500" />
        <MetricCard title="High Attention Staff" value={orgMetrics.HighAttentionStaff} subtitle="Staff with 10+ competency gaps" icon={Users} color="bg-orange-500" />
        <MetricCard title="Avg. Proficiency Gap" value={orgMetrics.AverageGapSize} subtitle="Rating points below required" icon={BarChart2} color="bg-blue-500" />
        <MetricCard title="Survey Participation" value={`${orgMetrics.ResponseRate}%`} subtitle={`${orgMetrics.TotalRespondents}/${orgMetrics.TotalStaff} staff`} icon={CheckCircle2} color="bg-green-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="font-bold text-lg text-slate-800 mb-4 flex items-center"><Target className="w-5 h-5 mr-2 text-red-500" />Top Critical Priorities</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={competencyPriorities.slice(0, 5)} layout="vertical" margin={{ left: 30, right: 30, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                <XAxis type="number" domain={[0, 'dataMax']} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => [`${value}% Gap Rate`, 'Gap Rate']} />
                <Bar dataKey="gapRate" fill="#e11d48" radius={[0, 4, 4, 0]} name="Staff Gap Rate %" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
           <h3 className="font-bold text-lg text-slate-800 mb-4 flex items-center"><Map className="w-5 h-5 mr-2 text-blue-500" />Division Gap Analysis</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={divisionData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis yAxisId="left" orientation="left" stroke="#3b82f6" label={{ value: 'Gap Rate %', angle: -90, position: 'insideLeft' }}/>
                <YAxis yAxisId="right" orientation="right" stroke="#f97316" label={{ value: 'Avg Gap Size', angle: 90, position: 'insideRight' }}/>
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="gapRate" fill="#3b82f6" name="Gap Rate %" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="avgGap" stroke="#f97316" strokeWidth={3} name="Avg Gap Size" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="font-bold text-lg text-slate-800 mb-4 flex items-center"><Layers className="w-5 h-5 mr-2 text-indigo-500" />Top Priority Groups (Click to Filter)</h3>
        {/* --- FIX 3.b (from BUG_FIX_SUMMARY.md) --- */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {groupPriorityData.map(group => (
            <GroupMetricCard
              key={group.name}
              title={group.name}
              value={`${group.avgGapRate.toFixed(1)}%`}
              subtitle={`Avg. Gap Rate (${group.staffAffected} gaps) `}
              icon={group.icon}
              color={group.color}
              isSelected={selectedGroup === group.name}
              onClick={() => handleGroupClick(group.name)}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
          <div>
            <h3 className="font-bold text-lg text-slate-800">Competency Priority Rankings</h3>
            {selectedGroup !== 'ALL' && (
              <p className="text-sm text-blue-600 font-medium">Filtered by: {selectedGroup}</p>
            )}
          </div>
          <div className="flex gap-4">
            {selectedGroup !== 'ALL' && (
               <button
                onClick={handleClearFilter}
                className="text-slate-600 hover:text-blue-700 text-sm font-medium flex items-center bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg"
              >
                <X className="w-4 h-4 mr-1" /> Clear Filter
              </button>
            )}
            <button
              onClick={handleExport}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg"
            >
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-6">Competency</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-6">Group</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-6">Staff Affected</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-6">Gap Rate</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-6">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCompetencies.map((item, index) => (
                <tr key={index} className="hover:bg-slate-50 transition-colors">
                  <td className="py-4 px-6 text-sm font-medium text-slate-800">
                    <div className="flex items-center">
                      <span>{item.name}</span>
                      <CompetencyInfo description={item.description} />
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-slate-500">{item.group}</td>
                  <td className="py-4 px-6 text-sm text-slate-600">{item.staffCount} staff</td>
                  <td className="py-4 px-6">
                    <div className="flex items-center">
                      <span className="text-sm text-slate-600 mr-2 w-12">{item.gapRate}%</span>
                      <div className="w-24 bg-slate-200 rounded-full h-2">
                        <div className={`h-2 rounded-full ${item.gapRate > 50 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${item.gapRate}%` }}></div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6"><PriorityBadge category={item.category} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});

// --- OPTIMIZATION: Moved pure function outside component ---
const getHeatmapColor = (score) => {
  if (score < 2.0) return 'bg-red-500 text-white';
  if (score < 3.0) return 'bg-orange-400 text-white';
  if (score < 4.0) return 'bg-yellow-300 text-slate-800';
  return 'bg-green-500 text-white';
};

const CompetencyHeatmap = memo(({ user }) => {
  const { heatmapData, competencyLibrary } = useContext(DatabaseContext);
  const { role, division } = user;
  const [selectedGroup, setSelectedGroup] = useState('ALL');

  const divisionsToShow = useMemo(() => {
    return role === 'admin' ? ['CTOC', 'CTLA', 'CTAC', 'CTFA'] : [division];
  }, [role, division]);

  const filteredHeatmapData = useMemo(() => {
    if (!heatmapData) return [];
    if (selectedGroup === 'ALL') {
      return heatmapData;
    }
    return heatmapData.filter(row => row.group === selectedGroup);
  }, [selectedGroup, heatmapData]);
  
  if (!heatmapData) return <div>Loading Heatmap...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Competency Heatmap</h2>
          <p className="text-slate-500">Visualizing proficiency hotspots. Lower scores (Red/Orange) indicate urgent training needs.</p>
        </div>
        <div className="flex items-center gap-3 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
          <Layers className="w-4 h-4 text-slate-400 ml-2" />
          <select
            className="bg-transparent text-sm font-medium text-slate-600 outline-none cursor-pointer"
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
          >
            <option value="ALL">All Groups</option>
            <option value="Core Technical">Core Technical</option>
            <option value="Analytical Toolkit">Analytical Toolkit</option>
            <option value="Behavioral">Behavioral</option>
            <option value="Future-Ready">Future-Ready</option>
          </select>
        </div>
      </div>
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="p-4 text-left text-sm font-semibold text-slate-500">Competency Area</th>
              {divisionsToShow.map(div => (
                <th key={div} className="p-4 text-center text-sm font-semibold text-slate-500">{div || 'N/A'}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredHeatmapData.map((row, index) => (
              <tr key={index} className="border-t border-slate-100">
                <td className="p-4 text-sm font-medium text-slate-800">
                  <div className="flex items-center">
                    <span>{row.competency}</span>
                    <CompetencyInfo description={competencyLibrary[row.competency]?.description} />
                  </div>
                  <span className="block text-xs text-slate-400">{row.group}</span>
                </td>
                {divisionsToShow.map(div => (
                  <td key={div} className="p-1">
                    <div className={`w-full h-12 rounded-md flex items-center justify-center text-sm font-bold ${getHeatmapColor(row[div])} transition-transform hover:scale-105 cursor-pointer`} title={`${div} - ${row.competency}: Avg Score ${row[div] ? row[div].toFixed(1) : 'N/A'}/5.0`}>
                      {row[div] ? row[div].toFixed(1) : 'N/A'}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-sm">
          <div className="flex items-center"><div className="w-4 h-4 bg-red-500 rounded mr-2"></div> Urgent Gap (&lt;2.0)</div>
          <div className="flex items-center"><div className="w-4 h-4 bg-orange-400 rounded mr-2"></div> Significant Gap (2.0-2.9)</div>
          <div className="flex items-center"><div className="w-4 h-4 bg-yellow-300 rounded mr-2"></div> Moderate Gap (3.0-3.9)</div>
          <div className="flex items-center"><div className="w-4 h-4 bg-green-500 rounded mr-2"></div> Strength (4.0+)</div>
        </div>
      </div>
    </div>
  );
});


// --- OPTIMIZATION: Moved pure function outside component ---
const generateReportHTML = (userData, ratingScale) => {
  const { name, position, grade, division, summary, feedback, competencies } = userData;

  const competencyRows = competencies
    .map(
      (comp) => `
    <tr class="${comp.priority === 'CRITICAL' ? 'critical' : ''}">
      <td>
        <strong>${comp.name}</strong>
        <span class="group">(${comp.group})</span>
      </td>
      <td class="center">${comp.current}</td>
      <td class="center">${comp.required}</td>
      <td class="center gap">${comp.gap > 0 ? comp.gap : 0}</td>
      <td>${comp.priority}</td>
    </tr>
  `
    )
    .join('');

  const ratingRows = ratingScale
    .map(
      (r) => `
    <tr>
      <td class="center"><strong>${r.level}</strong></td>
      <td><strong>${r.title}</strong></td>
      <td>${r.description}</td>
    </tr>
  `
    )
    .join('');

  return `
    <html>
    <head>
      <title>${name}'s Development Plan</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 20px; color: #333; }
        h1, h2, h3 { color: #111; border-bottom: 2px solid #eee; padding-bottom: 8px; }
        h1 { font-size: 28px; }
        h2 { font-size: 22px; margin-top: 30px; }
        h3 { font-size: 18px; margin-top: 24px; border-bottom: 1px solid #eee; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; font-size: 14px; }
        th { background-color: #f9f9f9; font-weight: 600; }
        .center { text-align: center; }
        .gap { font-weight: bold; color: #d9534f; }
        .critical { background-color: #fdf2f2; }
        .group { color: #555; font-size: 12px; margin-left: 5px; }
        .summary-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
        .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; background: #fafafa; }
        .card-title { font-size: 14px; font-weight: 600; color: #555; }
        .card-value { font-size: 28px; font-weight: 700; color: #000; }
        .footnote { margin-top: 40px; padding-top: 20px; border-top: 2px solid #eee; }
        .footnote h3 { border-bottom: none; }
        .footnote table th, .footnote table td { font-size: 12px; padding: 8px; }
      </style>
    </head>
    <body>
      <h1>${name}'s Development Plan</h1>
      <p style="font-size: 18px; color: #555;">${position} - ${grade} - ${division}</p>

      <h2>Summary</h2>
      <div class="summary-grid">
        <div class="card">
          <div class="card-title">Total Gaps Identified</div>
          <div class="card-value">${summary.totalGaps}</div>
        </div>
        <div class="card">
          <div class="card-title">Avg. Proficiency Gap</div>
          <div class="card-value">${summary.avgGap}</div>
        </div>
        <div class="card">
          <div class="card-title">Overall Gap Rate</div>
          <div class="card-value">${summary.gapRate}%</div>
        </div>
      </div>

      <h2>Staff Feedback</h2>
      <div class="summary-grid">
        <div class="card">
          <div class="card-title">Preferred Learning Method</div>
          <p>${feedback.preferredMethod}</p>
        </div>
        <div class="card">
          <div class="card-title">Key Enabler</div>
          <p>${feedback.enabler}</p>
        </div>
        <div class="card">
          <div class="card-title">Main Barrier</div>
          <p>${feedback.barrier}</p>
        </div>
      </div>
      
      <h2>Prioritized Development Actions</h2>
      <table>
        <thead>
          <tr>
            <th>Focus Area</th>
            <th class="center">Current</th>
            <th class="center">Required</th>
            <th class="center">Gap</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          ${competencyRows}
        </tbody>
      </table>

      <div class="footnote">
        <h3>Rating Scale Definitions</h3>
        <table>
          <thead>
            <tr>
              <th class="center">Level</th>
              <th>Title</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${ratingRows}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `;
};

// --- Re-usable component for Individual Plan (NOW WITH NEW PRINT LOGIC) ---
const IndividualDevelopmentPlan = memo(({ userEmail, onBack }) => {
  const { individualData } = useContext(DatabaseContext);
  const [selectedGroup, setSelectedGroup] = useState('ALL');
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  
  const userData = individualData ? individualData[userEmail] : null;

  // --- OPTIMIZATION: Wrap in useCallback ---
  const handlePrint = useCallback(() => {
    if (!userData) return;
    const ratingScale = [
      { level: 1, title: 'Novice', description: 'Has basic knowledge or awareness of the concept. Requires significant guidance and supervision.' },
      { level: 2, title: 'Learner', description: 'Can perform basic tasks with supervision. Is developing skills and understanding.' },
      { level: 3, title: 'Practitioner', description: 'Proficient. Can perform tasks independently and effectively. Can assist others.' },
      { level: 4, title: 'Expert', description: 'Has deep expertise. Can handle complex situations and guide others. A go-to person.' },
      { level: 5, title: 'Master', description: 'Is a recognized authority. Can innovate, set strategy, and teach all levels of the competency.' },
    ];
    const reportHTML = generateReportHTML(userData, ratingScale);
    const reportWindow = window.open('', '_blank');
    reportWindow.document.write(reportHTML);
    reportWindow.document.close();
    reportWindow.print();
  }, [userData]); // Depends on userData

  // --- OPTIMIZATION: Wrap in useCallback ---
  // --- FIX 5 (from BUG_FIX_SUMMARY.md) ---
  const handleDrillDown = useCallback((props) => {
    if (props && props.value && userData && userData.competencyRadarData && userData.competencyRadarData[props.value]) { // ✅ ADDED checks
      setSelectedGroup(props.value);
    }
  }, [userData]); // Depends on userData

  // --- FIX 4 (from BUG_FIX_SUMMARY.md) ---
  if (!userData) return <div>Loading individual data...</div>;

  if (!userData.groupRadarData || !userData.competencyRadarData) {
    console.error("User data is missing radar data:", userData);
    return <div>Error: Profile data incomplete. Please refresh the page.</div>;
  }
  // --- END FIX 4 ---

  // --- OPTIMIZATION: Memoize derived data ---
  const chartData = useMemo(() => {
    return selectedGroup === 'ALL'
      ? userData.groupRadarData
      : (userData.competencyRadarData[selectedGroup] || []); // ✅ ADDED Fallback
  }, [selectedGroup, userData]);

  const tableData = useMemo(() => {
    return selectedGroup === 'ALL'
      ? userData.competencies
      : userData.competencies.filter(c => c.group === selectedGroup);
  }, [selectedGroup, userData]);
  
  // --- OPTIMIZATION: Memoize modal callbacks ---
  const openRatingModal = useCallback(() => setIsRatingModalOpen(true), []);
  const closeRatingModal = useCallback(() => setIsRatingModalOpen(false), []);
  const handleBackToGroups = useCallback(() => setSelectedGroup('ALL'), []);

  return (
    <>
      <RatingScaleModal isOpen={isRatingModalOpen} onClose={closeRatingModal} />
      
      <div className="space-y-6">
        
        <div className="flex justify-between items-start plan-header">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{userData.name}'s Development Plan</h2>
            <p className="text-slate-500">{userData.position} - {userData.grade} - {userData.division}</p>
          </div>
          <div className="flex gap-2">
            {onBack && (
              <button onClick={onBack} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg flex items-center transition-colors">
                <ChevronRight className="w-4 h-4 mr-1 rotate-180" /> Back to Team
              </button>
            )}
            <button
              onClick={handlePrint}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center transition-colors"
            >
              <Download className="w-4 h-4 mr-2" /> Print Plan
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard title="Total Gaps Identified" value={userData.summary.totalGaps} icon={AlertTriangle} color="bg-orange-500" />
          <MetricCard title="Avg. Proficiency Gap" value={userData.summary.avgGap.toFixed(2)} icon={BarChart2} color="bg-blue-500" />
          <MetricCard title="Overall Gap Rate" value={`${userData.summary.gapRate.toFixed(1)}%`} icon={Target} color="bg-rose-500" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <FeedbackCard 
            icon={BookOpen} 
            title="Preferred Learning Method" 
            content={userData.feedback.preferredMethod} 
          />
          <FeedbackCard 
            icon={ThumbsUp} 
            title="Key Enabler" 
            content={userData.feedback.enabler} 
          />
          <FeedbackCard 
            icon={AlertTriangle} 
            title="Main Barrier" 
            content={userData.feedback.barrier} 
          />
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm min-h-[400px]">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center">
                <h3 className="font-bold text-lg text-slate-800">Competency Profile</h3>
                <button
                  onClick={openRatingModal}
                  className="ml-2 text-blue-500 hover:text-blue-700"
                  title="Show rating scale info"
                >
                  <Info className="w-5 h-5" />
                </button>
              </div>
              {selectedGroup !== 'ALL' && (
                <button
                  onClick={handleBackToGroups}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back to Groups
                </button>
              )}
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <RadarChart
                cx="50%" cy="50%"
                outerRadius="80%"
                data={chartData}
              >
                <PolarGrid />
                <PolarAngleAxis
                  dataKey="subject"
                  tick={{ fontSize: 12 }}
                  onClick={selectedGroup === 'ALL' ? handleDrillDown : undefined}
                  style={selectedGroup === 'ALL' ? { cursor: 'pointer' } : {}}
                />
                <PolarRadiusAxis angle={30} domain={[0, 5]} />
                <Radar name="Current" dataKey="A" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                <Radar name="Required" dataKey="B" stroke="#e11d48" fill="transparent" strokeWidth={2.5} strokeDasharray="4 4" />
                <Legend />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
            <p className="text-xs text-center text-slate-500 mt-4">
              {selectedGroup === 'ALL'
                ? "Click a group label on the chart to drill down."
                : `Showing detail for: ${selectedGroup}`
              }
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-lg text-slate-800">Prioritized Development Actions</h3>
              <p className="text-sm text-slate-500">
                {selectedGroup === 'ALL'
                  ? "Showing all competencies"
                  : `Filtered by: ${selectedGroup}`
                }
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-white">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Focus Area</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Group</th>
                    <th className="text-center text-xs font-semibold text-slate-500 uppercase py-3 px-6">Current vs Target</th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {tableData.map((comp, index) => (
                    <tr key={index} className={comp.priority === 'CRITICAL' ? 'bg-red-50/50' : 'hover:bg-slate-50'}>
                      <td className="py-4 px-6 font-medium text-slate-800">
                        <div className="flex items-center">
                          <span>{comp.name}</span>
                          <CompetencyInfo description={comp.description} />
                        </div>
                      </td>
                      <td className="py-4 px-6 text-sm text-slate-500">{comp.group}</td>
                      <td className="py-4 px-6 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-slate-100 text-slate-800">
                          Level {comp.current} <ChevronRight className="w-3 h-3 mx-1" /> Level {comp.required}
                        </span>
                      </td>
                      <td className="py-4 px-6"><PriorityBadge category={comp.priority} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
      </div>
    </>
  );
});

// --- OPTIMIZATION: Moved pure function outside component ---
const getConcernLevel = (totalGaps) => {
  if (totalGaps >= 15) {
    return { label: 'Critical', color: 'bg-red-100 text-red-800 border-red-300' };
  }
  if (totalGaps >= 10) {
    return { label: 'High', color: 'bg-orange-100 text-orange-800 border-orange-300' };
  }
  if (totalGaps >= 5) {
    return { label: 'Moderate', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' };
  }
  return { label: 'Low', color: 'bg-green-100 text-green-800 border-green-300' };
};

const SupervisorTeamView = memo(({ user }) => {
  const { individualData } = useContext(DatabaseContext);
  const [selectedStaffEmail, setSelectedStaffEmail] = useState(null);
  const [filter, setFilter] =useState({ division: user.division === 'ALL' ? 'ALL' : user.division, search: '' });

  // --- OPTIMIZATION: This was already memoized, which is good ---
  const allStaff = useMemo(() => individualData ? Object.values(individualData) : [], [individualData]);

  const filteredStaff = useMemo(() => {
    return allStaff.filter(staff => {
      const nameMatch = staff.name.toLowerCase().includes(filter.search.toLowerCase());
      
      if (user.role === 'admin') {
        const divisionMatch = filter.division === 'ALL' || staff.division === filter.division;
        return nameMatch && divisionMatch;
      } else {
        return nameMatch && staff.supervisorEmail === user.email;
      }
    });
  }, [allStaff, filter, user]);
  
  // --- OPTIMIZATION: Wrap in useCallback ---
  const handleViewPlan = useCallback((email) => {
    setSelectedStaffEmail(email);
  }, []); // No dependencies, as setSelectedStaffEmail is stable

  if (selectedStaffEmail) {
    return <IndividualDevelopmentPlan userEmail={selectedStaffEmail} onBack={() => setSelectedStaffEmail(null)} />;
  }
  
  if (!individualData) return <div>Loading team data...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">{user.role === 'admin' ? 'All Staff' : 'My Team'}</h2>
        <p className="text-slate-500">Review individual assessments for {user.role === 'admin' ? 'all staff' : 'your team members'}.</p>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by name..."
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            value={filter.search}
            onChange={e => setFilter(prev => ({ ...prev, search: e.target.value }))}
          />
        </div>
        {user.role === 'admin' && (
          <div className="flex items-center gap-3 border border-slate-300 rounded-lg px-3 py-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              className="bg-transparent text-sm font-medium text-slate-600 outline-none cursor-pointer"
              value={filter.division}
              onChange={e => setFilter(prev => ({ ...prev, division: e.target.value }))}
            >
              <option value="ALL">All Divisions</option>
              <option value="CTLA">CTLA</option>
              <option value="CTOC">CTOC</option>
              <option value="CTAC">CTAC</option>
              <option value="CTFA">CTFA</option>
            </select>
          </div>
        )}
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <h4 className="font-semibold text-slate-700 mb-3">Staff Concern Level (by Total Gaps)</h4>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center"><span className="w-4 h-4 rounded-full bg-green-500 mr-2"></span>0-4 Gaps (Low)</div>
          <div className="flex items-center"><span className="w-4 h-4 rounded-full bg-yellow-400 mr-2"></span>5-9 Gaps (Moderate)</div>
          <div className="flex items-center"><span className="w-4 h-4 rounded-full bg-orange-500 mr-2"></span>10-14 Gaps (High)</div>
          <div className="flex items-center"><span className="w-4 h-4 rounded-full bg-red-500 mr-2"></span>15+ Gaps (Critical)</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Name</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Position</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Position Grade</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Position Years</th>
                {user.role === 'admin' && <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Division</th>}
                <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Total Gaps</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Avg. Gap Size</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase py-3 px-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStaff.map(staff => {
                const concern = getConcernLevel(staff.summary.totalGaps);
                return (
                  <tr key={staff.email} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 text-sm font-medium text-slate-800">
                      <span className={`px-2.5 py-0.5 rounded-full font-medium text-xs border ${concern.color}`}>
                        {staff.name}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">{staff.position}</td>
                    <td className="py-4 px-6 text-sm text-slate-600">{staff.grade}</td>
                    <td className="py-4 px-6 text-sm text-slate-600">{staff.positionYears}</td>
                    {user.role === 'admin' && <td className="py-4 px-6 text-sm text-slate-600">{staff.division}</td>}
                    <td className="py-4 px-6 text-sm text-slate-600 font-medium">{staff.summary.totalGaps}</td>
                    <td className="py-4 px-6 text-sm text-slate-600">{staff.summary.avgGap.toFixed(2)}</td>
                    <td className="py-4 px-6">
                      <button
                        onClick={() => handleViewPlan(staff.email)}
                        className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center"
                      >
                        <Eye className="w-4 h-4 mr-1" /> View Plan
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});


// --- 6. LAYOUT COMPONENT ---

const DashboardLayout = () => {
  const { user, logout } = useContext(AuthContext);
  const { loading } = useContext(DatabaseContext);
  const [activeView, setActiveView] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (user?.role === 'staff') setActiveView('learning');
    else if (user?.role === 'supervisor') setActiveView('team_view');
    else setActiveView('dashboard');
  }, [user]);

  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, roles: ['admin'] },
    { id: 'heatmap', label: 'Skill Heatmap', icon: Map, roles: ['admin', 'supervisor'] },
    { id: 'learning', label: 'My Learning', icon: GraduationCap, roles: ['staff', 'supervisor'] },
    { id: 'team_view', label: user.role === 'admin' ? 'All Staff' : 'My Team', icon: Users, roles: ['admin', 'supervisor'] },
  ];

  const allowedNav = navItems.filter(item => item.roles.includes(user.role));

  // --- OPTIMIZATION: Memoize callbacks ---
  const handleNavClick = useCallback((viewId) => {
    setActiveView(viewId);
  }, []); // setActiveView is stable

  const handleMobileNavClick = useCallback((viewId) => {
    setActiveView(viewId);
    setMobileMenuOpen(false);
  }, []); // setActiveView/setMobileMenuOpen are stable
  
  const handleLogout = useCallback(() => {
    logout();
  }, [logout]); // logout is stable from context

  const renderView = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <svg className="mx-auto h-12 w-12 text-blue-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <p className="mt-2 text-lg font-semibold text-slate-600">Loading Dashboard Data...</p>
          </div>
        </div>
      );
    }
    switch(activeView) {
      case 'dashboard':
        return <AdminDashboard />;
      case 'heatmap':
        return <CompetencyHeatmap user={user} />;
      case 'learning':
        return <IndividualDevelopmentPlan userEmail={user.email} />;
      case 'team_view':
        return <SupervisorTeamView user={user} />;
      default:
        return <AdminDashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      
      <aside id="sidebar-nav" className="hidden md:flex flex-col w-64 bg-slate-900 text-slate-300">
        <div className="p-6 flex items-center space-x-3">
          <div className="bg-blue-600 p-2 rounded-lg"><TrendingUp className="w-6 h-6 text-white" /></div>
          <span className="text-white font-bold text-xl tracking-tight">CTL Insight</span>
        </div>
        <nav className="flex-1 px-4 py-4 space-y-1">
          {allowedNav.map(item => (
            <button key={item.id} onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                activeView === item.id ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <item.icon className="w-5 h-5 mr-3" />{item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center mb-4 px-4">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-white">
              {/* --- FIX: Add check for user.name or user.email before charAt --- */}
              {(user.name || user.email) ? (user.name || user.email).charAt(0).toUpperCase() : '?'}
            </div>
            <div className="ml-3 overflow-hidden">
              <p className="text-sm font-medium text-white truncate">{user.name || user.email}</p>
              <p className="text-xs text-slate-500 capitalize">{user.role}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <LogOut className="w-5 h-5 mr-3" />Sign Out
          </button>
        </div>
      </aside>

      <div id="mobile-header" className="md:hidden fixed top-0 left-0 right-0 bg-slate-900 text-white p-4 flex justify-between z-20">
          <div className="flex items-center space-x-2">
             <TrendingUp className="w-6 h-6 text-blue-500" /><span className="font-bold">CTL Insight</span>
          </div>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>{mobileMenuOpen ? <X /> : <Menu />}</button>
      </div>
      {mobileMenuOpen && (
        <div id="mobile-menu" className="md:hidden fixed inset-0 bg-slate-900 z-10 pt-16">
           <nav className="p-4 space-y-2">
             {allowedNav.map(item => (
                <button key={item.id} onClick={() => handleMobileNavClick(item.id)}
                  className={`w-full flex items-center px-4 py-3 text-lg font-medium rounded-lg ${
                    activeView === item.id ? 'bg-blue-600 text-white' : 'text-slate-300'
                  }`}
                >
                  <item.icon className="w-6 h-6 mr-3" />{item.label}
                </button>
              ))}
              <button onClick={handleLogout} className="w-full flex items-center px-4 py-3 text-lg text-red-400 mt-8">
                 <LogOut className="w-6 h-6 mr-3" /> Sign Out
              </button>
           </nav>
        </div>
      )}

      <main id="main-content" className="flex-1 p-6 md:p-8 overflow-y-auto mt-14 md:mt-0">
        {renderView()}
      </main>
    </div>
  );
};

// --- 7. MAIN APP ---

export default function App() {
  // Config is hardcoded now, so no need for the "YOUR_API_KEY" check
  
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

const AppContent = () => {
  const { user, loading } = useContext(AuthContext);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <svg className="h-12 w-12 text-blue-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
      </div>
    );
  }

  return (
    <>
      {/* PrintStyles component is removed, no longer needed */}
      {user ? (
        <DatabaseProvider>
          <DashboardLayout />
        </DatabaseProvider>
      ) : (
        <LoginPage />
      )}
    </>
  );
};