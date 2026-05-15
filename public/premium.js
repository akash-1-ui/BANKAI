/* ============================================
   PREMIUM ACCESS SYSTEM - PREMIUM PAGE LOGIC
   PIN Validation, Password Handling, & Navigation
   ============================================ */

// Configuration
const PIN_RANGES = [
    { start: '23XZ1A0501', end: '23XZ1A0526' },
    { start: '24XZ5A0501', end: '24XZ5A0517' }
];

const PASSWORD_MIN_LENGTH = 6;
const STORAGE_KEYS = {
    PIN: 'userPin',
    PASSWORD: 'userPassword',
    PAYMENT_STATUS: 'paymentStatus'
};

// ============================================
// Helper Functions
// ============================================

/**
 * Convert PIN to uppercase
 */
function normalizePIN(pin) {
    return pin.trim().toUpperCase();
}

/**
 * Extract numeric portion from PIN for range comparison
 */
function extractPINNumber(pin) {
    // Extract the numeric part from PIN like "23XZ5A0501" -> 501
    const match = pin.match(/(\d+)$/);
    return match ? parseInt(match[1]) : 0;
}

/**
 * Check if a PIN falls within allowed ranges
 */
function isValidPIN(pin) {
    const normalized = normalizePIN(pin);
    
    // Check format (10 characters, e.g. 23XZ1A0501)
    if (normalized.length !== 10) return false;
    
    // Check each range
    for (let range of PIN_RANGES) {
        if (normalized >= range.start && normalized <= range.end) {
            return true;
        }
    }
    return false;
}

/**
 * Calculate password strength
 */
function calculatePasswordStrength(password) {
    let strength = 0;
    
    if (password.length >= 6) strength += 25;
    if (password.length >= 12) strength += 25;
    if (/[a-z]/.test(password)) strength += 25;
    if (/[A-Z]/.test(password)) strength += 25;
    if (/[0-9]/.test(password)) strength += 25;
    if (/[^a-zA-Z0-9]/.test(password)) strength += 25;
    
    return Math.min(strength, 100);
}

/**
 * Get password strength label and color
 */
function getPasswordStrengthLabel(strength) {
    if (strength < 25) return { label: 'Weak', class: 'weak' };
    if (strength < 50) return { label: 'Fair', class: 'fair' };
    if (strength < 75) return { label: 'Good', class: 'good' };
    return { label: 'Strong', class: 'strong' };
}

/**
 * Show modal alert
 */
function showAlert(title, message, isError = true) {
    const modal = document.getElementById('alertModal');
    document.getElementById('alertTitle').textContent = title;
    document.getElementById('alertMessage').textContent = message;
    modal.classList.add('show');
}

function friendlyPremiumMessage(message, fallback) {
    const text = String(message || '').trim();

    if (!text) return fallback;
    if (/file:\/\//i.test(text)) {
        return 'Please open this app from the local server, not directly as a file. Start the server with npm start, then visit http://localhost:3000/premium.html.';
    }
    if (/already/i.test(text)) {
        return 'This PIN already has an account. Use Login with your PIN and password to continue.';
    }
    if (/password/i.test(text)) {
        return 'The password does not match this PIN. Please check it and try again.';
    }
    if (/account|pin/i.test(text)) {
        return 'We could not find an active account for this PIN. Please check the PIN or create a new account.';
    }

    return text;
}

/**
 * Hide alert modal
 */
function hideAlert() {
    const modal = document.getElementById('alertModal');
    modal.classList.remove('show');
}

/**
 * Show error message inline
 */
function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.classList.add('show');
    }
}

/**
 * Hide error message inline
 */
function hideError(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = '';
        element.classList.remove('show');
    }
}

/**
 * Show success message inline
 */
function showSuccess(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.classList.add('show');
    }
}

/**
 * Hide success message inline
 */
function hideSuccess(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = '';
        element.classList.remove('show');
    }
}

/**
 * Check whether this browser already has an account saved for a PIN.
 */
function hasSavedAccountForPIN(pin) {
    const storedPin = localStorage.getItem(STORAGE_KEYS.PIN);
    const storedPassword = localStorage.getItem(STORAGE_KEYS.PASSWORD);
    return Boolean(storedPin && storedPassword && normalizePIN(storedPin) === normalizePIN(pin));
}

async function postPremiumAccount(endpoint, payload) {
    // Only reject if using file:// protocol
    if (window.location.protocol === 'file:') {
        throw new Error('Please open this app from the local server, not directly as a file. Start the server with npm start, then visit http://localhost:3000/premium.html.');
    }

    // Allow any local server (localhost, 127.0.0.1, Live Server, etc.)
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
        console.warn('⚠️  Non-local hostname detected:', hostname);
    }

    // Always use port 3000 for API calls (Node.js server)
    // This ensures Live Server (5500) requests go to the backend on 3000
    const apiUrl = `http://localhost:3000${endpoint}`;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
        throw new Error(data.error || 'Account request failed. Please try again.');
    }

    return data;
}

function saveAccountSession(pin, password) {
    localStorage.setItem(STORAGE_KEYS.PIN, normalizePIN(pin));
    localStorage.setItem(STORAGE_KEYS.PASSWORD, password);
    localStorage.setItem(STORAGE_KEYS.PAYMENT_STATUS, 'success');
}

function showSuccessRedirect(message) {
    const successModal = document.getElementById('successModal');
    const successMsg = document.getElementById('successMessage');

    if (successModal && successMsg) {
        successMsg.textContent = message;
        successModal.classList.add('show');

        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
    } else {
        window.location.href = 'index.html';
    }
}

// ============================================
// PIN Validation
// ============================================

const pinInput = document.getElementById('pinNumber');

if (pinInput) {
    pinInput.addEventListener('input', (e) => {
        // Convert to uppercase automatically
        e.target.value = normalizePIN(e.target.value);
    });

    pinInput.addEventListener('blur', () => {
        const pin = pinInput.value.trim();
        
        if (!pin) {
            hideError('pinError');
            hideSuccess('pinSuccess');
            return;
        }
        
        if (isValidPIN(pin)) {
            hideError('pinError');
            showSuccess('pinSuccess', '✓ Valid PIN');
        } else {
            hideSuccess('pinSuccess');
            showError('pinError', '✗ Invalid PIN format or unauthorized');
        }
    });
}

// ============================================
// Password Validation
// ============================================

const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');

if (newPasswordInput) {
    newPasswordInput.addEventListener('input', (e) => {
        const password = e.target.value;
        const strength = calculatePasswordStrength(password);
        const { label, class: strengthClass } = getPasswordStrengthLabel(strength);
        
        // Update strength bar
        const strengthBar = document.getElementById('strengthBar');
        if (strengthBar) {
            strengthBar.style.setProperty('--strength', strength + '%');
            strengthBar.style.width = strength + '%';
            strengthBar.className = 'strength-bar ' + strengthClass;
        }
        
        // Update strength text
        const strengthText = document.getElementById('strengthText');
        if (strengthText) {
            strengthText.textContent = label;
        }
        
        // Clear errors when user starts typing
        if (password.length >= PASSWORD_MIN_LENGTH) {
            hideError('passwordError');
        }
        
        // Check if confirm password matches
        if (confirmPasswordInput && confirmPasswordInput.value) {
            if (password === confirmPasswordInput.value) {
                hideError('confirmError');
                showSuccess('confirmSuccess', '✓ Passwords match');
            } else {
                hideSuccess('confirmSuccess');
                showError('confirmError', '✗ Passwords do not match');
            }
        }
    });

    newPasswordInput.addEventListener('blur', () => {
        const password = newPasswordInput.value;
        
        if (password && password.length < PASSWORD_MIN_LENGTH) {
            showError('passwordError', `✗ Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
        } else if (password) {
            hideError('passwordError');
        }
    });
}

if (confirmPasswordInput) {
    confirmPasswordInput.addEventListener('input', (e) => {
        const confirmPassword = e.target.value;
        const password = newPasswordInput?.value || '';
        
        if (!confirmPassword) {
            hideSuccess('confirmSuccess');
            hideError('confirmError');
            return;
        }
        
        if (password === confirmPassword) {
            hideError('confirmError');
            showSuccess('confirmSuccess', '✓ Passwords match');
        } else {
            hideSuccess('confirmSuccess');
            showError('confirmError', '✗ Passwords do not match');
        }
    });

    confirmPasswordInput.addEventListener('blur', () => {
        const confirmPassword = confirmPasswordInput.value;
        const password = newPasswordInput?.value || '';
        
        if (confirmPassword && !password) {
            showError('confirmError', '✗ Please enter password first');
        }
    });
}

// ============================================
// Show/Hide Password Toggle
// ============================================

document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', (e) => {
        e.preventDefault();
        
        const targetId = button.getAttribute('data-target');
        const input = document.getElementById(targetId);
        
        if (input) {
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            
            // Update icon
            const icon = button.querySelector('.toggle-icon');
            if (icon) {
                icon.textContent = isPassword ? '👁️‍🗨️' : '👁️';
            }
        }
    });
});

document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', () => {
        const targetId = button.getAttribute('data-target');
        const input = document.getElementById(targetId);
        const icon = button.querySelector('.toggle-icon');
        if (input && icon) {
            icon.textContent = input.type === 'text' ? 'Hide' : 'Show';
        }
    });
});

// ============================================
// Form Submission
// ============================================

const premiumForm = document.getElementById('premiumForm');

if (premiumForm) {
    premiumForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const pin = normalizePIN(pinInput?.value || '');
        const password = newPasswordInput?.value || '';
        const confirmPassword = confirmPasswordInput?.value || '';
        
        // Validation
        if (!pin) {
            showError('pinError', 'PIN is required');
            return;
        }
        
        if (!isValidPIN(pin)) {
            showAlert('PIN Not Eligible', 'This PIN is not in the eligible student range for premium access. Please check the PIN and try again.', true);
            return;
        }

        if (!password) {
            showError('passwordError', 'Password is required');
            return;
        }
        
        if (password.length < PASSWORD_MIN_LENGTH) {
            showError('passwordError', `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
            return;
        }
        
        if (!confirmPassword) {
            showError('confirmError', 'Please confirm your password');
            return;
        }
        
        if (password !== confirmPassword) {
            showError('confirmError', 'Passwords do not match');
            return;
        }

        try {
            await postPremiumAccount('/api/premium/register', { pin, password });
            saveAccountSession(pin, password);
            showSuccessRedirect('Your account is ready. Taking you to Micromize...');
        } catch (error) {
            const message = friendlyPremiumMessage(error.message, 'We could not create your account right now. Please try again.');
            if (/already/i.test(error.message)) {
                showAlert('Account Already Exists', message, true);
            } else {
                showAlert('Account Setup Failed', message, true);
            }
        }
    });
}

// ============================================
// Already Activated Verification
// ============================================

const verifyAccessBtn = document.getElementById('verifyAccessBtn');
const premiumCardFlipper = document.getElementById('premiumCardFlipper');
const returnSignupBtn = document.getElementById('returnSignupBtn');
const verifyModal = document.getElementById('verifyModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const verifyForm = document.getElementById('verifyForm');
const verifyPinInput = document.getElementById('verifyPin');

if (verifyPinInput) {
    verifyPinInput.addEventListener('input', (e) => {
        e.target.value = normalizePIN(e.target.value);
    });
}

if (verifyAccessBtn) {
    verifyAccessBtn.addEventListener('click', (e) => {
        e.preventDefault();
        hideError('verifyPinError');
        hideError('verifyPasswordError');
        if (verifyForm) verifyForm.reset();
        if (premiumCardFlipper) premiumCardFlipper.classList.add('is-flipped');
        setTimeout(() => document.getElementById('verifyPin')?.focus(), 450);
    });
}

if (returnSignupBtn) {
    returnSignupBtn.addEventListener('click', () => {
        hideError('verifyPinError');
        hideError('verifyPasswordError');
        if (verifyForm) verifyForm.reset();
        if (premiumCardFlipper) premiumCardFlipper.classList.remove('is-flipped');
        setTimeout(() => pinInput?.focus(), 450);
    });
}

if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
        if (verifyModal) {
            verifyModal.classList.remove('show');
            // Reset form
            if (verifyForm) {
                verifyForm.reset();
                document.getElementById('verifyPinError').classList.remove('show');
                document.getElementById('verifyPasswordError').classList.remove('show');
            }
        }
    });
}

// Close modal when clicking outside
if (verifyModal) {
    verifyModal.addEventListener('click', (e) => {
        if (e.target === verifyModal) {
            verifyModal.classList.remove('show');
            if (verifyForm) {
                verifyForm.reset();
                document.getElementById('verifyPinError').classList.remove('show');
                document.getElementById('verifyPasswordError').classList.remove('show');
            }
        }
    });
}

if (verifyForm) {
    verifyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const verifyPin = normalizePIN(document.getElementById('verifyPin')?.value || '');
        const verifyPassword = document.getElementById('verifyPassword')?.value || '';
        
        // Clear previous errors
        hideError('verifyPinError');
        hideError('verifyPasswordError');
        
        // Validate
        let hasError = false;
        
        if (!verifyPin) {
            showError('verifyPinError', 'PIN is required');
            hasError = true;
        } else if (!isValidPIN(verifyPin)) {
            showError('verifyPinError', 'Invalid PIN format');
            hasError = true;
        }
        
        if (!verifyPassword) {
            showError('verifyPasswordError', 'Password is required');
            hasError = true;
        }
        
        if (hasError) return;

        try {
            await postPremiumAccount('/api/premium/login', {
                pin: verifyPin,
                password: verifyPassword
            });

            saveAccountSession(verifyPin, verifyPassword);

            if (verifyModal) {
                verifyModal.classList.remove('show');
            }

            showSuccessRedirect('Login successful. Taking you to Micromize...');
        } catch (error) {
            const message = friendlyPremiumMessage(error.message, 'We could not log you in right now. Please try again.');
            if (/password/i.test(error.message)) {
                showError('verifyPasswordError', message);
            } else if (/account|pin/i.test(error.message)) {
                showError('verifyPinError', message);
            } else {
                showAlert('Login Failed', message, true);
            }
        }
    });
}

// ============================================
// Alert Modal Close Handler
// ============================================

const alertCloseBtn = document.getElementById('alertCloseBtn');

if (alertCloseBtn) {
    alertCloseBtn.addEventListener('click', () => {
        hideAlert();
    });
}

// Close alert when clicking outside
const alertModal = document.getElementById('alertModal');
if (alertModal) {
    alertModal.addEventListener('click', (e) => {
        if (e.target === alertModal) {
            hideAlert();
        }
    });
}

// ============================================
// Initialize on Page Load
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    // Check if an account already has access while payments are paused.
    const storedPin = localStorage.getItem(STORAGE_KEYS.PIN);
    const storedPassword = localStorage.getItem(STORAGE_KEYS.PASSWORD);
    
    if (storedPin && storedPassword) {
        try {
            await postPremiumAccount('/api/premium/login', {
                pin: storedPin,
                password: storedPassword
            });
            window.location.href = 'index.html';
        } catch (error) {
            localStorage.removeItem(STORAGE_KEYS.PIN);
            localStorage.removeItem(STORAGE_KEYS.PASSWORD);
            localStorage.removeItem(STORAGE_KEYS.PAYMENT_STATUS);
        }
    }
});

// ============================================
// Keyboard Navigation
// ============================================

document.addEventListener('keydown', (e) => {
    // Close modals with Escape key
    if (e.key === 'Escape') {
        const modals = document.querySelectorAll('.modal.show');
        modals.forEach(modal => {
            modal.classList.remove('show');
        });
    }
});
