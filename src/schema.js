// Column names, display labels and the small vocabularies the demo survey draws on.
// Everything here is data about the *demo file*; the engine itself is column-agnostic
// apart from the ladders it is handed.

export const COL = {
  age: 'How old are you?',
  grade: 'What grade are you in?',
  activity: 'What is your main after-school activity?',
  homeroom: 'Which homeroom are you in?',
  sleep: 'On a school night, how many hours do you sleep?',
  safe: 'Do you feel safe at school?',
  vaped: 'Have you ever been offered a vape?',
};

export const ORDER = [COL.age, COL.grade, COL.activity, COL.homeroom, COL.sleep, COL.safe, COL.vaped];

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export const SHORT = {
  [COL.age]: 'Age',
  [COL.grade]: 'Grade',
  [COL.activity]: 'Activity',
  [COL.homeroom]: 'Homeroom',
  [COL.sleep]: 'Sleep',
  [COL.safe]: 'Safety',
  [COL.vaped]: 'Vaping',
};

// Columns the user is allowed to declare as quasi-identifiers.
export const QI_CANDIDATES = [COL.age, COL.grade, COL.activity, COL.homeroom, COL.sleep];

// The value a suppressed cell collapses to.
export const SUPPRESSED = '∗'; // ∗

export const ACTIVITIES = ['Robotics', 'Band', 'Soccer', 'Debate', 'Theater', 'Track', 'Newspaper', 'Chess'];

export const ACTIVITY_CATEGORY = {
  Robotics: 'STEM',
  Chess: 'STEM',
  Band: 'Arts',
  Theater: 'Arts',
  Newspaper: 'Arts',
  Soccer: 'Sport',
  Track: 'Sport',
  Debate: 'Academic',
};

export const ACTIVITY_BROAD = {
  Soccer: 'Competitive',
  Track: 'Competitive',
  Debate: 'Competitive',
  Chess: 'Competitive',
  Robotics: 'Competitive',
  Band: 'Creative',
  Theater: 'Creative',
  Newspaper: 'Creative',
};

export const ACTIVITY_PHRASE = {
  STEM: 'a STEM activity',
  Arts: 'an arts activity',
  Sport: 'a sport',
  Academic: 'an academic activity',
  Competitive: 'a competitive activity',
  Creative: 'a creative activity',
};

export const HOMEROOMS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
