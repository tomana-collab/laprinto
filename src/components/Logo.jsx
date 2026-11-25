import logo from '../assets/logo.png'
import logoDark from '../assets/logo-dark.png'

// לוגו Laprinto ברקע שקוף: גרסה שחורה למצב בהיר וגרסה לבנה (עם נקודת הזהב) למצב כהה
export default function Logo({ className = '' }) {
  return (
    <span className={`logo ${className}`}>
      <img className="logo-light" src={logo} alt="Laprinto" />
      <img className="logo-dark" src={logoDark} alt="Laprinto" />
    </span>
  )
}
