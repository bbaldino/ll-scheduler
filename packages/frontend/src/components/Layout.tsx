import { Outlet, Link } from 'react-router-dom';
import { useSeason } from '../contexts/SeasonContext';
import styles from './Layout.module.css';

export default function Layout() {
  const { currentSeason, seasons, setCurrentSeason } = useSeason();

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>Little League Scheduler</h1>
          <nav className={styles.nav}>
            <Link to="/seasons" className={styles.navLink}>
              Seasons
            </Link>
            <Link to="/divisions" className={styles.navLink}>
              Divisions
            </Link>
            <Link to="/fields" className={styles.navLink}>
              Fields
            </Link>
            <Link to="/batting-cages" className={styles.navLink}>
              Batting Cages
            </Link>
            <Link to="/teams" className={styles.navLink}>
              Teams
            </Link>
          </nav>          <div className={styles.seasonSelector}>
            <label htmlFor="season-select">Current Season:</label>
            <select
              id="season-select"
              value={currentSeason?.id || ''}
              onChange={(e) => {
                const season = seasons.find((s) => s.id === e.target.value);
                setCurrentSeason(season || null);
              }}
              className={styles.select}
            >
              {seasons.length === 0 && <option value="">No seasons</option>}
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
