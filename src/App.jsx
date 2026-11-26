
import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Layout } from './components/Layout';
import { TermsGate } from './components/TermsGate';
import { Auth } from './pages/Auth';

// Student Pages
import { StudentDashboard } from './pages/StudentDashboard';
import { StudentRepertoire } from './pages/StudentRepertoire';
import { StudentLevel } from './pages/StudentLevel';
import { StudentClasses } from './pages/StudentClasses';
import { StudentPayments } from './pages/StudentPayments';
import { StudentProfile } from './pages/StudentProfile';

// Teacher Pages
import { TeacherDashboard } from './pages/TeacherDashboard';
import { TeacherStudents } from './pages/TeacherStudents';
import { Announcements } from './pages/Announcements';
import { NoticeHistory } from './pages/NoticeHistory';
import { TeacherAgenda } from './pages/TeacherAgenda';
import { TeacherGrades } from './pages/TeacherGrades';

// Academy Pages
import { AcademyDashboard } from './pages/AcademyDashboard';
import { AcademySettings } from './pages/AcademySettings';
import { AcademyStudents } from './pages/AcademyStudents';
import { AcademyAssessments } from './pages/AcademyAssessments';
import { AcademyRooms } from './pages/AcademyRooms';
import { AcademyPanel } from './pages/AcademyPanel';
import { AcademyLevelRequests } from './pages/AcademyLevelRequests';
import { AcademyGrades } from './pages/AcademyGrades';
import { AcademySubstitutes } from './pages/AcademySubstitutes';
import { AcademyCancellations } from './pages/AcademyCancellations';
import { AcademyPayments } from './pages/AcademyPayments';
import { AcademyTerms } from './pages/AcademyTerms';



function AppContent() {
  const { user, logout } = useApp();
  const [currentView, setCurrentView] = useState(() => {
    return localStorage.getItem('pianoApp_currentView') || 'dashboard';
  });

  React.useEffect(() => {
    localStorage.setItem('pianoApp_currentView', currentView);
  }, [currentView]);

  if (!user) {

    return <Auth onLoginSuccess={() => setCurrentView('dashboard')} />;
  }

  const renderView = () => {
    // Opened from the "Avisos" card, for every role
    if (currentView === 'notices') return <NoticeHistory onBack={() => setCurrentView('dashboard')} />;

    if (user.role === 'student') {
      switch (currentView) {
        case 'dashboard': return <StudentDashboard onViewChange={setCurrentView} />;
        case 'repertoire': return <StudentRepertoire />;
        case 'level': return <StudentLevel />;
        case 'classes': return <StudentClasses />;
        case 'payments': return <StudentPayments />;
        case 'profile': return <StudentProfile onViewChange={setCurrentView} />;
        default: return <StudentDashboard onViewChange={setCurrentView} />;
      }
    } else if (user.role === 'teacher') {
      switch (currentView) {
        case 'dashboard': return <TeacherDashboard onViewChange={setCurrentView} />;
        // 'enrollment' was the old "Mis estudiantes", now merged with the repertoire
        case 'students':
        case 'enrollment': return <TeacherStudents />;
        case 'announcements': return <Announcements />;
        case 'agenda': return <TeacherAgenda />;
        case 'grades': return <TeacherGrades />;
        default: return <TeacherDashboard onViewChange={setCurrentView} />;
      }
    } else if (user.role === 'academy') {
      switch (currentView) {
        case 'settings': return <AcademySettings />;
        case 'students': return <AcademyStudents />;
        case 'assessments': return <AcademyAssessments />;
        case 'levels': return <AcademyLevelRequests />;
        case 'grades': return <AcademyGrades />;
        case 'announcements': return <Announcements />;
        case 'substitutes': return <AcademySubstitutes />;
        case 'cancellations': return <AcademyCancellations />;
        case 'payments': return <AcademyPayments />;
        case 'terms': return <AcademyTerms />;
        case 'rooms': return <AcademyRooms />;
        case 'teachers': return <AcademyDashboard />;
        default: return <AcademyPanel onViewChange={setCurrentView} />;
      }
    }
  };

  return (
    <TermsGate user={user} onLogout={logout}>
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        {renderView()}
      </Layout>
    </TermsGate>
  );
}


class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-red-50 text-red-900 h-screen overflow-auto">
          <h1 className="text-2xl font-bold mb-4">Algo salió mal.</h1>
          <details className="whitespace-pre-wrap font-mono text-sm">
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>

    </ErrorBoundary>
  );
}

export default App;

