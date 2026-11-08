import { SAMPLE_PHOTOS } from '../data/samplePeople';

const COLORS = ['#2563eb', '#7c3aed', '#0f766e', '#b45309', '#be123c', '#4338ca'];

// A profile photo when the sample has one; otherwise the initials, on a colour
// that stays the same for the same name.
export default function PersonAvatar({ name }) {
  const photo = SAMPLE_PHOTOS[name];
  if (photo) {
    return <img alt="" aria-hidden="true" className="person-avatar person-avatar-photo" src={photo} />;
  }
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
  const hash = [...name].reduce((total, char) => total + char.charCodeAt(0), 0);
  return (
    <span aria-hidden="true" className="person-avatar" style={{ background: COLORS[hash % COLORS.length] }}>
      {initials}
    </span>
  );
}
