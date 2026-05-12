/* ============================================
   PREMIUM ACCESS SYSTEM - RAZORPAY PAYMENT PAGE
   ============================================ */

const STORAGE_KEYS = {
    PIN: 'userPin',
    PASSWORD: 'userPassword',
    PAYMENT_STATUS: 'paymentStatus'
};

document.addEventListener('DOMContentLoaded', () => {
    const userPin = localStorage.getItem(STORAGE_KEYS.PIN);
    const userPassword = localStorage.getItem(STORAGE_KEYS.PASSWORD);
    const paymentStatus = localStorage.getItem(STORAGE_KEYS.PAYMENT_STATUS);

    if (!userPin || !userPassword) {
        window.location.href = 'premium.html';
        return;
    }

    if (paymentStatus === 'success') {
        window.location.href = 'index.html';
        return;
    }

    setupPaymentOptions();
    setupPaymentButton();
    setupBackButton();
    setupErrorRetry();
    setupKeyboardPayment();
});

function setupPaymentOptions() {
    document.querySelectorAll('.payment-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.payment-option').forEach(opt => {
                opt.classList.remove('selected');
            });

            option.classList.add('selected');

            const radio = option.querySelector('input[type="radio"]');
            if (radio) {
                radio.checked = true;
            }
        });
    });
}

function setupPaymentButton() {
    const paymentBtn = document.getElementById('paymentBtn');

    if (paymentBtn) {
        paymentBtn.addEventListener('click', (e) => {
            e.preventDefault();
            processPayment();
        });
    }
}

function setupBackButton() {
    const backBtn = document.getElementById('backBtn');

    if (backBtn) {
        backBtn.addEventListener('click', () => {
            window.location.href = 'premium.html';
        });
    }
}

function setupErrorRetry() {
    const errorRetryBtn = document.getElementById('errorRetryBtn');

    if (errorRetryBtn) {
        errorRetryBtn.addEventListener('click', () => {
            hideError();
            setPaymentLoading(false);
        });
    }
}

function setupKeyboardPayment() {
    document.addEventListener('keydown', (e) => {
        const activeElement = document.activeElement;

        if (e.key === 'Enter' && activeElement?.id === 'paymentBtn') {
            e.preventDefault();
            processPayment();
        }
    });
}

async function processPayment() {
    if (window.location.protocol === 'file:') {
        showError(
            'Open Through Server',
            'Start the app with npm start, then open http://localhost:3000/payment.html. Razorpay cannot start from a local file path.'
        );
        return;
    }

    if (!window.Razorpay) {
        showError('Razorpay Not Loaded', 'Payment gateway is still loading. Please refresh and try again.');
        return;
    }

    setPaymentLoading(true);

    try {
        const order = await createRazorpayOrder();
        setPaymentLoading(false);

        const paymentResponse = await openRazorpayCheckout(order);
        setPaymentLoading(true);
        await verifyRazorpayPayment(paymentResponse);
        completePayment();
    } catch (error) {
        setPaymentLoading(false);
        showError('Payment Failed', error.message || 'Payment could not be completed. Please try again.');
    }
}

async function createRazorpayOrder() {
    let response;

    try {
        response = await fetch('/api/razorpay/order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pin: localStorage.getItem(STORAGE_KEYS.PIN)
            })
        });
    } catch (error) {
        throw new Error('Payment server is not reachable. Run npm start and open the app from http://localhost:3000 or the server URL shown in the terminal.');
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.error || 'Unable to create Razorpay order.');
    }

    return payload;
}

function openRazorpayCheckout(order) {
    return new Promise((resolve, reject) => {
        const checkout = new Razorpay({
            key: order.key,
            amount: order.amount,
            currency: order.currency,
            name: order.displayName || 'Micromize',
            description: 'Micromize Lifetime Unlimited Access',
            order_id: order.id,
            notes: {
                pin: localStorage.getItem(STORAGE_KEYS.PIN) || '',
                plan: 'Lifetime Unlimited Access'
            },
            theme: {
                color: '#667eea'
            },
            handler: resolve,
            modal: {
                ondismiss: () => reject(new Error('Payment was cancelled before completion.'))
            }
        });

        checkout.on('payment.failed', (response) => {
            reject(new Error(response.error?.description || 'Razorpay reported a payment failure.'));
        });

        checkout.open();
    });
}

async function verifyRazorpayPayment(paymentResponse) {
    const response = await fetch('/api/razorpay/verify', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(paymentResponse)
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Payment verification failed.');
    }
}

function completePayment() {
    setPaymentLoading(false);
    localStorage.setItem(STORAGE_KEYS.PAYMENT_STATUS, 'success');

    const successModal = document.getElementById('successModal');

    if (successModal) {
        successModal.classList.add('show');
    }

    setTimeout(() => {
        window.location.href = 'index.html';
    }, 2500);
}

function setPaymentLoading(isLoading) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const paymentBtn = document.getElementById('paymentBtn');

    if (loadingOverlay) {
        loadingOverlay.classList.toggle('hidden', !isLoading);
    }

    if (paymentBtn) {
        paymentBtn.disabled = isLoading;

        const btnLoader = paymentBtn.querySelector('.btn-loader');
        const btnContent = paymentBtn.querySelector('.btn-content');

        if (btnLoader && btnContent) {
            btnContent.classList.toggle('hidden', isLoading);
            btnLoader.classList.toggle('hidden', !isLoading);
        }
    }
}

function showError(title, message) {
    const errorModal = document.getElementById('errorModal');
    const errorTitle = document.getElementById('errorTitle');
    const errorMessage = document.getElementById('errorMessage');

    if (errorTitle) errorTitle.textContent = title;
    if (errorMessage) errorMessage.textContent = message;
    if (errorModal) errorModal.classList.add('show');
}

function hideError() {
    const errorModal = document.getElementById('errorModal');
    if (errorModal) errorModal.classList.remove('show');
}

function handleResponsive() {
    const isMobile = window.innerWidth < 768;

    if (isMobile) {
        document.querySelectorAll('.summary-item').forEach(item => {
            item.style.padding = '0.75rem 0';
        });
    }
}

window.addEventListener('resize', handleResponsive);
handleResponsive();

window.debugPayment = {
    getStoredData: () => ({
        pin: localStorage.getItem(STORAGE_KEYS.PIN),
        password: localStorage.getItem(STORAGE_KEYS.PASSWORD),
        paymentStatus: localStorage.getItem(STORAGE_KEYS.PAYMENT_STATUS)
    }),
    resetPayment: () => {
        localStorage.removeItem(STORAGE_KEYS.PAYMENT_STATUS);
        window.location.reload();
    }
};
