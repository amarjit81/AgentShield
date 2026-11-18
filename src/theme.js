import { createTheme } from '@mui/material/styles';

// System fonts keep the interface fast and avoid distributing commercial fonts.
const theme = createTheme({
  palette: {
    primary: { main: '#30273d', contrastText: '#fffef5' },
    secondary: { main: '#e5d5f5', contrastText: '#211f24' },
    background: { default: '#faf9ef', paper: '#fffef8' },
    text: { primary: '#252429', secondary: '#66646a' },
    divider: '#deddd2',
    success: { main: '#32634c' }, warning: { main: '#875a1c' }, error: { main: '#a53e3e' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    h4: { fontWeight: 500, letterSpacing: '-.04em' },
    h5: { fontWeight: 500, letterSpacing: '-.025em' },
    h6: { fontSize: '1.12rem', fontWeight: 600, letterSpacing: '-.02em' },
    button: { textTransform: 'none', fontWeight: 600 },
    overline: { fontSize: '.7rem', letterSpacing: '.15em', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 42, padding: '9px 18px', borderRadius: 7 }, containedPrimary: { '&:hover': { backgroundColor: '#4b3b60' } } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', boxShadow: 'none' } } },
    MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: '#fffef8', borderRadius: 7 }, notchedOutline: { borderColor: '#c9c7bd' } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: '#e5e3da', padding: '14px 16px' }, head: { color: '#68616f', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.09em', backgroundColor: '#f1f0e7' } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 5, fontSize: '.73rem' } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 7 }, standardInfo: { backgroundColor: '#efedf5', color: '#423751' } } },
    MuiCssBaseline: { styleOverrides: { ':focus-visible': { outline: '3px solid #9271b4', outlineOffset: 3 } } },
  },
});
export default theme;
