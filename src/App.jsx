import React, { useState, useEffect, useRef } from 'react';
import { Settings, Send, CheckCircle, Info, HelpCircle } from 'lucide-react';

// Base URL from .env file (VITE_BACKEND_URL)
// e.g. http://192.168.1.100:5000  →  set in frontend/.env
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

export default function App() {
  // Connection State
  const [connectionState, setConnectionState] = useState('connecting'); // connecting, connected, failed

  // API Config
  const [apiKey, setApiKey] = useState('');
  const [departments, setDepartments] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [costCodesList, setCostCodesList] = useState([]);
  const [employeesList, setEmployeesList] = useState([]);
  const [makesList, setMakesList] = useState([]);

  // Chat State
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeItem, setActiveItem] = useState(null); // the item currently being indent-processed

  const messagesEndRef = useRef(null);

  // Initialize Connection using VITE_BACKEND_URL from .env
  useEffect(() => {
    loadBackendConfig(BACKEND_URL);
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, suggestions]);

  // Load configuration from backend
  const loadBackendConfig = async (url = BACKEND_URL) => {
    setConnectionState('connecting');
    try {
      // 1. Fetch API Key
      const configRes = await fetch(`${BACKEND_URL}/api/chatbot/config`);
      const configData = await configRes.json();
      const key = configData.apiKey;
      setApiKey(key);

      // 2. Fetch Lists in parallel
      const headers = { 'x-api-key': key };
      const [deptRes, seriesRes, costRes, empRes, makeRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/chatbot/departments`, { headers }),
        fetch(`${BACKEND_URL}/api/chatbot/series`, { headers }),
        fetch(`${BACKEND_URL}/api/chatbot/cost-codes`, { headers }),
        fetch(`${BACKEND_URL}/api/chatbot/employees`, { headers }),
        fetch(`${BACKEND_URL}/api/chatbot/makes`, { headers })
      ]);

      const depts = await deptRes.json();
      const series = await seriesRes.json();
      const costs = await costRes.json();
      const emps = await empRes.json();
      const makes = await makeRes.json();

      setDepartments(depts);
      setSeriesList(series);
      setCostCodesList(costs);
      setEmployeesList(emps);
      setMakesList(makes);
      setConnectionState('connected');

      // Welcome User
      addBotMessage(
        "नमस्ते! मैं आपका <strong>Procurement & Inventory Assistant</strong> हूँ। 🤖<br>मैं स्टोर में स्टॉक चेक कर सकता हूँ और ज़रूरत पड़ने पर Oracle database में नया Indent डाल सकता हूँ।",
        [
          { label: "Check Stock / Search Item", action: promptSearchItem }
        ]
      );
    } catch (err) {
      console.error('Connection failed:', err);
      setConnectionState('failed');
      addBotMessage('⚠️ Failed to initialize connection to backend database. Please check connection settings or make sure the backend is running.');
    }
  };

  // Helper to add Bot Message
  const addBotMessage = (text, options = null, extraProps = {}) => {
    const newMsg = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      sender: 'bot',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      options,
      ...extraProps
    };
    setMessages(prev => [...prev, newMsg]);
  };

  // Helper to add User Message
  const addUserMessage = (text) => {
    const newMsg = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, newMsg]);
  };

  // Retry Connection (reload page)
  const handleResetConnection = () => {
    if (window.confirm('Retry connection to backend?')) {
      window.location.reload();
    }
  };

  // Flow State Actions
  const promptSearchItem = () => {
    addBotMessage("स्टॉक चेक करने या इंडेंट डालने के लिए आइटम का नाम या कोड टाइप करें (उदा. BOLT):");
  };

  // Handle Autocomplete Suggestions Input
  const handleInputChange = async (e) => {
    const val = e.target.value;
    setInputValue(val);

    if (val.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/chatbot/items?q=${encodeURIComponent(val)}`, {
        headers: { 'x-api-key': apiKey }
      });
      const data = await res.json();
      setSuggestions(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Handle item search submit
  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    const val = inputValue.trim();
    if (!val) return;

    setInputValue('');
    setSuggestions([]);
    addUserMessage(val);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chatbot/items?q=${encodeURIComponent(val)}`, {
        headers: { 'x-api-key': apiKey }
      });
      const items = await res.json();

      if (items.length > 0) {
        // Render item list selection buttons
        addBotMessage("मुझे ये आइटम मिले हैं, कृपया इनमें से एक चुनें:", 
          items.slice(0, 10).map(item => ({
            label: `${item.itemName} (${item.itemCode})`,
            action: () => handleSelectSearchItem(item)
          }))
        );
      } else {
        addBotMessage(`⚠️ मुझे "${val}" नाम या कोड से कोई आइटम नहीं मिला। कृपया पुनः प्रयास करें।`);
      }
    } catch (err) {
      console.error(err);
      addBotMessage("⚠️ आइटम सर्च करते समय कोई त्रुटि हुई।");
    }
  };

  // Handle choosing item from dropdown or buttons
  const handleSelectSearchItem = (item) => {
    setSuggestions([]);
    addUserMessage(`Selected: ${item.itemName} (${item.itemCode})`);
    checkItemStock(item);
  };

  // Check Stock from database
  const checkItemStock = async (item) => {
    addBotMessage("Wait, stock search ho raha hai...");
    
    try {
      const res = await fetch(`${BACKEND_URL}/api/chatbot/stock/${item.itemCode}`, {
        headers: { 'x-api-key': apiKey }
      });
      const data = await res.json();
      const stock = data.stock;

      const stockCard = {
        itemCode: item.itemCode,
        itemName: item.itemName,
        stock,
        um: item.um
      };

      if (stock > 0) {
        addBotMessage(
          `स्टोर में <strong>${item.itemName}</strong> उपलब्ध है। स्टॉक: <strong>${stock} ${item.um}</strong>। आप इसे इश्यू करा सकते हैं। धन्यवाद!`,
          [
            { label: "Search Another Item", action: promptSearchItem }
          ],
          { stockCard }
        );
      } else {
        addBotMessage(
          `स्टोर में स्टॉक उपलब्ध नहीं है (0)। क्या आप इंडेंट डालना चाहते हैं?`,
          [
            { label: "हाँ, इंडेंट डालें", action: () => showIndentForm(item) },
            { label: "नहीं, धन्यवाद", action: sayThanks }
          ],
          { stockCard }
        );
      }
    } catch (err) {
      console.error(err);
      addBotMessage("⚠️ स्टॉक चेक करते समय त्रुटि हुई।");
    }
  };

  const sayThanks = () => {
    addUserMessage("नहीं, धन्यवाद");
    addBotMessage("धन्यवाद! यदि आपको कुछ और चाहिए तो बताइए।", [
      { label: "Search Another Item", action: promptSearchItem }
    ]);
  };

  // Show Indent Form card
  const showIndentForm = (item) => {
    addUserMessage("हाँ, इंडेंट डालें");
    setActiveItem(item);
    addBotMessage("कृपया नीचे दिए गए फॉर्म में इंडेंट विवरण भरें:", null, {
      indentForm: true,
      formItem: item
    });
  };

  // Handle Form Cancel
  const handleFormCancel = (msgId) => {
    // Disable form in history
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, indentForm: false, disabledForm: true } : m));
    addUserMessage("Cancel");
    addBotMessage("इंडेंट प्रक्रिया रद्द कर दी गई है।", [
      { label: "Search Item Again", action: promptSearchItem }
    ]);
  };

  // Handle Form Submit (Verify stage)
  const handleFormSubmit = (msgId, formData) => {
    // Disable form in history
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, indentForm: false, disabledForm: true } : m));
    addUserMessage("Submit Indent Form");

    // Add confirmation summary card
    addBotMessage("कृपया विवरण सत्यापित करें और डेटाबेस में भेजने के लिए <strong>Confirm</strong> करें:", [
      { label: "Confirm & Send to DB", action: () => submitIndentToDb(formData) },
      { label: "Edit / Cancel", action: promptSearchItem }
    ], {
      summaryCard: formData
    });
  };

  // Save Indent to Oracle
  const submitIndentToDb = async (formData) => {
    addUserMessage("Confirm & Send to DB");

    try {
      const response = await fetch(`${BACKEND_URL}/api/chatbot/indent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify(formData)
      });

      const result = await response.json();

      if (result.success) {
        addBotMessage(
          `बधाई हो! इंडेंट सफलतापूर्वक रेस (Raise) हो गया है और डेटाबेस में भेज दिया गया है।`,
          [
            { label: "Raise Another Indent", action: promptSearchItem }
          ],
          {
            successCard: {
              vrNo: result.vrNo,
              message: `Indent ${result.vrNo} raised successfully!`
            }
          }
        );
      } else {
        addBotMessage(`❌ इंडेंट डालने में विफलता: ${result.error || 'अज्ञात त्रुटि'}`);
      }
    } catch (err) {
      console.error(err);
      addBotMessage("⚠️ डेटाबेस में इंडेंट डालते समय कोई त्रुटि हुई।");
    }
  };

  return (
    <>
      <div className="glass-bg"></div>
      <div className="container">
        
        {/* Header */}
        <header className="app-header">
          <div className="header-logo">🤖</div>
          <div className="header-titles">
            <h1>Procurement & Store Assistant</h1>
            <p>Real-time Inventory Check & Auto-Indent System</p>
          </div>
        </header>

        {/* Chat Wrapper */}
        <main className="chat-wrapper">
          <div className="chat-container">
            
            {/* Chat Header */}
            <div className="chat-header">
              <div className="bot-avatar">
                <span className={`status-indicator ${
                  connectionState === 'connected' ? 'online' : 
                  connectionState === 'connecting' ? 'warning' : 'danger'
                }`}></span>
                🤖
              </div>
              <div className="bot-info">
                <h3>StoreBot</h3>
                <span className="bot-status" style={{
                  color: connectionState === 'connected' ? 'var(--success)' : 
                         connectionState === 'connecting' ? 'var(--warning)' : 'var(--danger)'
                }}>
                  {connectionState === 'connected' ? 'Connected to Oracle DB' : 
                   connectionState === 'connecting' ? 'Connecting to Backend...' : 'Connection Failed'}
                </span>
              </div>
              
              <button className="settings-btn" onClick={handleResetConnection} title="Retry Connection">
                <Settings size={18} />
              </button>
            </div>

            {/* Chat Messages */}
            <div className="chat-messages">
              {messages.map((msg) => (
                <div key={msg.id} className={`message ${msg.sender}`}>
                  <div className="message-bubble">
                    <span dangerouslySetInnerHTML={{ __html: msg.text }}></span>

                    {/* Render Stock Card */}
                    {msg.stockCard && (
                      <div className={`card stock-card ${msg.stockCard.stock <= 0 ? 'out-of-stock' : ''}`}>
                        <div className="card-title">
                          {msg.stockCard.stock > 0 ? <CheckCircle size={16} /> : <Info size={16} />}
                          {msg.stockCard.stock > 0 ? 'Store me available hai!' : 'Store me nahi hai!'}
                        </div>
                        <div className="card-content">
                          Item: <strong>{msg.stockCard.itemName}</strong> ({msg.stockCard.itemCode})<br />
                          Current Stock: <strong>{msg.stockCard.stock} {msg.stockCard.um}</strong><br />
                          Status: <strong>{msg.stockCard.stock > 0 ? 'Available' : 'Out of Stock'}</strong>
                        </div>
                      </div>
                    )}

                    {/* Render Summary Confirmation Card */}
                    {msg.summaryCard && (
                      <div className="summary-card">
                        <div className="card-title" style={{ color: 'var(--secondary)' }}>Verify Details</div>
                        <div className="summary-list">
                          <div className="summary-item"><span className="label">Item Name:</span><span className="value">{msg.summaryCard.itemName}</span></div>
                          <div className="summary-item"><span className="label">Quantity:</span><span className="value">{msg.summaryCard.qty}</span></div>
                          <div className="summary-item"><span className="label">Requested By:</span><span className="value">{msg.summaryCard.empName} ({msg.summaryCard.userCode})</span></div>
                          <div className="summary-item"><span className="label">Department:</span><span className="value">{msg.summaryCard.deptCode}</span></div>
                          <div className="summary-item"><span className="label">Series:</span><span className="value">{msg.summaryCard.series}</span></div>
                          <div className="summary-item"><span className="label">Division:</span><span className="value">{msg.summaryCard.divCode || 'N/A'}</span></div>
                          <div className="summary-item"><span className="label">Cost Center:</span><span className="value">{msg.summaryCard.costCode}</span></div>
                          <div className="summary-item"><span className="label">Make:</span><span className="value">{msg.summaryCard.makeName ? `${msg.summaryCard.makeName} (${msg.summaryCard.make})` : (msg.summaryCard.make || 'N/A')}</span></div>
                          <div className="summary-item"><span className="label">Specs:</span><span className="value">{msg.summaryCard.specs}</span></div>
                          <div className="summary-item"><span className="label">Purpose:</span><span className="value">{msg.summaryCard.purpose}</span></div>
                          <div className="summary-item"><span className="label">Required By:</span><span className="value">{msg.summaryCard.dueDate}</span></div>
                        </div>
                      </div>
                    )}

                    {/* Render Success Card */}
                    {msg.successCard && (
                      <div className="card" style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)' }}>
                        <div className="card-title" style={{ color: 'var(--success)' }}>🎉 Indent Raised Successfully!</div>
                        <div className="card-content" style={{ color: 'var(--text-primary)' }}>
                          Voucher Number (VRNO): <strong>{msg.successCard.vrNo}</strong><br />
                          Status: <strong>Inserted in Oracle DB</strong>
                        </div>
                      </div>
                    )}

                    {/* Render Inline Indent Form */}
                    {msg.indentForm && (
                      <IndentForm 
                        item={msg.formItem} 
                        departments={departments} 
                        seriesList={seriesList}
                        costCodesList={costCodesList}
                        employeesList={employeesList}
                        makesList={makesList}
                        onSubmit={(data) => handleFormSubmit(msg.id, data)}
                        onCancel={() => handleFormCancel(msg.id)}
                      />
                    )}

                    {/* Render Options Buttons */}
                    {msg.options && msg.options.length > 0 && (
                      <div className="options-container">
                        {msg.options.map((opt, i) => (
                          <button key={i} className="option-btn" onClick={() => {
                            // Clear buttons from state on click
                            msg.options = null;
                            addUserMessage(opt.label);
                            opt.action();
                          }}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="message-time">{msg.time}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Suggestions list popup panel */}
            {suggestions.length > 0 && (
              <div className="suggestions-panel">
                {suggestions.map((item) => (
                  <div key={item.itemCode} className="suggestion-item" onClick={() => handleSelectSearchItem(item)}>
                    <span className="suggestion-text">{item.itemName}</span>
                    <span className="suggestion-code">{item.itemCode}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Chat Footer Input */}
            <div className="chat-footer">
              <form className="input-form" onSubmit={handleSearchSubmit}>
                <input 
                  type="text" 
                  value={inputValue}
                  onChange={handleInputChange}
                  placeholder="Search item code or name (e.g., BOLT)..." 
                  disabled={connectionState !== 'connected'}
                />
                <button type="submit" className="send-btn" disabled={connectionState !== 'connected'}>
                  <Send size={16} />
                </button>
              </form>
            </div>

          </div>
        </main>
      </div>

    </>
  );
}

// Inline Form Component for cleaner state updates
function IndentForm({ item, departments, seriesList, costCodesList, employeesList, makesList, onSubmit, onCancel }) {
  const [qty, setQty] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [series, setSeries] = useState('');
  const [costCode, setCostCode] = useState('');
  const [empCode, setEmpCode] = useState('');
  const [makeCode, setMakeCode] = useState('');
  const [selectedDivCode, setSelectedDivCode] = useState('');
  const [specs, setSpecs] = useState(item.itemName || '');
  const [purpose, setPurpose] = useState('');
  
  // Search state variables
  const [empSearch, setEmpSearch] = useState('');
  const [makeSearch, setMakeSearch] = useState('');
  const [isEmpFocused, setIsEmpFocused] = useState(false);
  const [isMakeFocused, setIsMakeFocused] = useState(false);
  
  // Default Due Date: today + 30 days
  const defaultDueDate = new Date();
  defaultDueDate.setDate(defaultDueDate.getDate() + 30);
  const formattedDefaultDate = defaultDueDate.toISOString().split('T')[0];
  const [dueDate, setDueDate] = useState(formattedDefaultDate);

  // Automatically resolve division based on selected series
  useEffect(() => {
    if (series === 'I1') {
      setSelectedDivCode('SM');
    } else if (series === 'I3') {
      setSelectedDivCode('RP');
    } else if (series === 'I4') {
      setSelectedDivCode('PM');
    } else {
      setSelectedDivCode('');
    }
  }, [series]);

  // Filter lists based on search queries
  const filteredEmployees = employeesList.filter(e => {
    const term = empSearch.toLowerCase();
    if (!term) return true;
    const fullNameAndCode = `${e.empName} (${e.empCode})`.toLowerCase();
    if (fullNameAndCode === term) return true;
    return (
      e.empName.toLowerCase().includes(term) ||
      e.empCode.toLowerCase().includes(term)
    );
  });

  const filteredMakes = makesList.filter(m => {
    const term = makeSearch.toLowerCase();
    if (!term) return true;
    const fullNameAndCode = `${m.makeName} (${m.makeCode})`.toLowerCase();
    if (fullNameAndCode === term) return true;
    return (
      m.makeName.toLowerCase().includes(term) ||
      m.makeCode.toLowerCase().includes(term)
    );
  });

  const handleEmpSearchChange = (val) => {
    setEmpSearch(val);
    const selectedEmp = employeesList.find(e => e.empCode === empCode);
    const selectedText = selectedEmp ? `${selectedEmp.empName} (${selectedEmp.empCode})` : '';
    if (val !== selectedText) {
      setEmpCode('');
    }
  };

  const handleMakeSearchChange = (val) => {
    setMakeSearch(val);
    const selectedMake = makesList.find(m => m.makeCode === makeCode);
    const selectedText = selectedMake ? `${selectedMake.makeName} (${selectedMake.makeCode})` : '';
    if (val !== selectedText) {
      setMakeCode('');
    }
  };

  // Auto-select when exactly 1 option matches
  useEffect(() => {
    if (filteredEmployees.length === 1 && !empCode) {
      const emp = filteredEmployees[0];
      setEmpCode(emp.empCode);
      setEmpSearch(`${emp.empName} (${emp.empCode})`);
    }
  }, [filteredEmployees.length, empCode]);

  useEffect(() => {
    if (filteredMakes.length === 1 && !makeCode) {
      const m = filteredMakes[0];
      setMakeCode(m.makeCode);
      setMakeSearch(`${m.makeName} (${m.makeCode})`);
    }
  }, [filteredMakes.length, makeCode]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!empCode) {
      alert("Please select an Employee.");
      return;
    }
    if (!qty || isNaN(qty) || Number(qty) <= 0) {
      alert("Please enter a valid positive quantity.");
      return;
    }
    if (!deptCode) {
      alert("Please select a Department.");
      return;
    }
    if (!series) {
      alert("Please select an Indent Series.");
      return;
    }
    if (series === 'I5' && !selectedDivCode) {
      alert("Please select a Division.");
      return;
    }
    if (!costCode) {
      alert("Please select a Cost Center.");
      return;
    }
    if (!makeCode) {
      alert("Please select Preferred Make/Brand.");
      return;
    }
    if (!specs.trim()) {
      alert("Please enter specifications.");
      return;
    }
    if (!purpose.trim()) {
      alert("Please enter purpose of procurement.");
      return;
    }

    const selectedEmp = employeesList.find(e => e.empCode === empCode);
    const empName = selectedEmp ? selectedEmp.empName : '';

    const selectedMake = makesList.find(m => m.makeCode === makeCode);
    const makeName = selectedMake ? selectedMake.makeName : '';

    onSubmit({
      itemCode: item.itemCode,
      itemName: item.itemName,
      qty,
      um: item.um,
      deptCode,
      series,
      divCode: selectedDivCode, // Custom resolved or selected division
      costCode,
      userCode: empCode, // emp_code goes to createdby and user_code
      empName, // emp_name goes to indent_remark
      make: makeCode, // makeCode goes to backend
      makeName, // makeName for verify details display
      specs,
      purpose,
      dueDate
    });
  };

  return (
    <form className="chat-form-card" onSubmit={handleSubmit}>
      <h4 className="card-title" style={{ color: 'var(--primary)', marginBottom: '4px' }}>Raise Indent Form</h4>
      
      <div className="form-group" style={{ position: 'relative' }}>
        <label>Employee (Requested By) *</label>
        <div style={{ position: 'relative' }}>
          <input 
            type="text" 
            value={empSearch}
            onChange={(e) => handleEmpSearchChange(e.target.value)}
            onFocus={() => setIsEmpFocused(true)}
            onBlur={() => {
              setTimeout(() => setIsEmpFocused(false), 200);
            }}
            placeholder="Search employee by name or code..." 
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'var(--text-primary)',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              outline: 'none',
              width: '100%',
              paddingRight: '30px'
            }}
            required
          />
          <span style={{
            position: 'absolute',
            right: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-secondary)',
            pointerEvents: 'none',
            fontSize: '0.75rem'
          }}>▼</span>
          
          {isEmpFocused && filteredEmployees.length > 0 && (
            <div className="custom-dropdown-panel">
              {filteredEmployees.slice(0, 50).map(e => (
                <div 
                  key={e.empCode}
                  onMouseDown={() => {
                    setEmpCode(e.empCode);
                    setEmpSearch(`${e.empName} (${e.empCode})`);
                    setIsEmpFocused(false);
                  }}
                  className="custom-dropdown-item"
                >
                  <span>{e.empName}</span>
                  <span className="custom-dropdown-item-badge">{e.empCode}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="form-group">
        <label>Item Name</label>
        <input type="text" value={`${item.itemName} (${item.itemCode})`} disabled style={{ opacity: 0.7 }} />
      </div>

      <div className="form-group">
        <label>Quantity Required ({item.um}) *</label>
        <input 
          type="number" 
          value={qty} 
          onChange={(e) => setQty(e.target.value)} 
          placeholder="Enter quantity..." 
          min="1" 
          step="any" 
          required 
        />
      </div>

      <div className="form-group">
        <label>Department *</label>
        <select value={deptCode} onChange={(e) => setDeptCode(e.target.value)} required>
          <option value="" disabled>Select Department...</option>
          {departments.map(d => (
            <option key={d.deptCode} value={d.deptCode}>{d.deptName} ({d.deptCode})</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Indent Series *</label>
        <select value={series} onChange={(e) => setSeries(e.target.value)} required>
          <option value="" disabled>Select Indent Series...</option>
          {seriesList.map(s => (
            <option key={s.series} value={s.series}>{s.series} - {s.descr} ({s.entityCode})</option>
          ))}
        </select>
      </div>

      {series === 'I5' && (
        <div className="form-group">
          <label>Division *</label>
          <select value={selectedDivCode} onChange={(e) => setSelectedDivCode(e.target.value)} required>
            <option value="" disabled>Select Division...</option>
            <option value="CO">CORPORATE/COMMON (CO)</option>
            <option value="SM">STEEL MELTING SHOP (SMS) (SM)</option>
            <option value="RM">TMT ROLLING MILL (RM)</option>
            <option value="RP">PATRA ROLLING MILL (RP)</option>
            <option value="PM">PIPE MILL (PM)</option>
          </select>
        </div>
      )}

      <div className="form-group">
        <label>Cost Center (Cost Code) *</label>
        <select value={costCode} onChange={(e) => setCostCode(e.target.value)} required>
          <option value="" disabled>Select Cost Center...</option>
          {costCodesList.map(c => (
            <option key={c.costCode} value={c.costCode}>{c.costName} ({c.costCode})</option>
          ))}
        </select>
      </div>

      <div className="form-group" style={{ position: 'relative' }}>
        <label>Preferred Make/Brand *</label>
        <div style={{ position: 'relative' }}>
          <input 
            type="text" 
            value={makeSearch}
            onChange={(e) => handleMakeSearchChange(e.target.value)}
            onFocus={() => setIsMakeFocused(true)}
            onBlur={() => {
              setTimeout(() => setIsMakeFocused(false), 200);
            }}
            placeholder="Search make by name or code..." 
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'var(--text-primary)',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              outline: 'none',
              width: '100%',
              paddingRight: '30px'
            }}
            required
          />
          <span style={{
            position: 'absolute',
            right: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-secondary)',
            pointerEvents: 'none',
            fontSize: '0.75rem'
          }}>▼</span>
          
          {isMakeFocused && filteredMakes.length > 0 && (
            <div className="custom-dropdown-panel">
              {filteredMakes.slice(0, 50).map(m => (
                <div 
                  key={m.makeCode}
                  onMouseDown={() => {
                    setMakeCode(m.makeCode);
                    setMakeSearch(`${m.makeName} (${m.makeCode})`);
                    setIsMakeFocused(false);
                  }}
                  className="custom-dropdown-item"
                >
                  <span>{m.makeName}</span>
                  <span className="custom-dropdown-item-badge">{m.makeCode}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="form-group">
        <label>Specifications / Details *</label>
        <textarea 
          value={specs} 
          onChange={(e) => setSpecs(e.target.value)} 
          placeholder="Enter procurement specifications..." 
          required 
        />
      </div>

      <div className="form-group">
        <label>Purpose of Procurement *</label>
        <textarea 
          value={purpose} 
          onChange={(e) => setPurpose(e.target.value)} 
          placeholder="What is this item being procured for?" 
          required 
        />
      </div>

      <div className="form-group">
        <label>Required By (Due Date) *</label>
        <input 
          type="date" 
          value={dueDate} 
          onChange={(e) => setDueDate(e.target.value)} 
          required 
        />
      </div>

      <div className="form-actions">
        <button type="button" className="form-btn cancel" onClick={onCancel}>Cancel</button>
        <button type="submit" className="form-btn submit">Submit Indent</button>
      </div>
    </form>
  );
}
