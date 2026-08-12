import React from 'react';
import { Text, View } from 'react-native';
import { useController } from './productVerificationController';

export default function ProductVerificationScreen() {
    const { styles, t } = useController();

    return (
        <View style={styles.container}>
            <Text>{t('productVerification.title')}</Text>
        </View>
    );
}
